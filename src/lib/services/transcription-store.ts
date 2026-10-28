import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import {
  parseTranscriptionJobPayload,
  type ChannelCredentialAcquisition,
  type RequesterCredentialResolution,
  type ThinkingLevel,
  type TranscriptionStatus,
  type TranscriptionStore,
} from '@/lib/services/transcription'
import { buildSiteUrl } from '@/lib/env/getSiteUrl'
import { AppError } from '@/lib/utils/errors'
import { extractYouTubeVideoId } from '@/lib/utils/youtube-video-id'

/** Errore stabile e senza dettagli: il messaggio del database non esce dal servizio. */
function dbError(message: string, cause?: string): AppError {
  return new AppError(message, 'unknown', 500, cause ? { cause } : undefined)
}

/** Massimo di chiavi non decifrabili escluse in una sola richiesta di assegnazione. */
const MAX_UNREADABLE_KEYS_PER_ACQUISITION = 5

type AdminClient = ReturnType<typeof createAdminClient>

/** Id della trascrizione di un job (dal payload), per azzerare i tentativi delle sue parti. */
async function readTranscriptionId(admin: AdminClient, jobId: string): Promise<string | null> {
  const { data, error } = await admin.from('jobs').select('payload').eq('id', jobId).maybeSingle()
  if (error) throw dbError('Impossibile leggere il job di trascrizione', error.message)
  return parseTranscriptionJobPayload(data?.payload)?.transcriptionId ?? null
}

async function releaseCredential(admin: AdminClient, input: {
  jobId: string
  leaseId: string
  credentialId: string
  keyVersion: string
  status: 'exhausted' | 'ineligible'
  transcriptionId: string
  partPosition: number | null
  lastError: string | null
}): Promise<boolean> {
  const { data, error } = await admin.rpc('release_transcription_job_credential', {
    p_job_id: input.jobId,
    p_lease_id: input.leaseId,
    p_credential_id: input.credentialId,
    p_key_version: input.keyVersion,
    p_status: input.status,
    p_transcription_id: input.transcriptionId,
    p_part_position: input.partPosition,
    p_last_error: input.lastError,
  })
  if (error) throw dbError('Impossibile rilasciare la chiave Gemini', error.message)
  return data === true
}

async function recordPartExhausted(admin: AdminClient, input: {
  jobId: string
  leaseId: string
  transcriptionId: string
  partPosition: number
  credential: { credentialId?: string; keyVersion?: string }
  lastError: string | null
}): Promise<boolean> {
  if (!input.credential.credentialId || !input.credential.keyVersion) return false
  const { data, error } = await admin.rpc('record_transcription_part_key_exhausted', {
    p_job_id: input.jobId,
    p_lease_id: input.leaseId,
    p_transcription_id: input.transcriptionId,
    p_part_position: input.partPosition,
    p_credential_id: input.credential.credentialId,
    p_key_version: input.credential.keyVersion,
    p_last_error: input.lastError,
  })
  if (error) throw dbError('Impossibile registrare la chiave esaurita', error.message)
  return data === true
}

/** Store di produzione: tutte le scritture con il client service_role. */
export function createSupabaseTranscriptionStore(admin = createAdminClient()): TranscriptionStore {
  return {
    async claimJob(input) {
      const { data, error } = await admin.rpc('claim_transcription_job_with_attempt', {
        p_job_id: input.jobId,
        p_started_at: input.startedAt,
        p_lease_id: input.leaseId,
        p_lease_expires_at: input.leaseExpiresAt,
      })
      if (error) throw dbError('Impossibile acquisire il job di trascrizione', error.message)
      const claim = data?.[0]
      if (!claim) return null
      const payload = parseTranscriptionJobPayload(claim.payload)
      if (!payload || claim.lease_id !== input.leaseId) throw new AppError('Job di trascrizione non valido', 'structural', 500)
      return { attemptId: claim.attempt_id, payload }
    },

    async loadContext(payload) {
      const { data: transcription, error } = await admin
        .from('transcriptions')
        .select('id, video_id, status, model, thinking_level')
        .eq('id', payload.transcriptionId)
        .maybeSingle()
      if (error) throw dbError('Impossibile leggere la trascrizione', error.message)
      if (!transcription) return null

      const [videoResult, partsResult, profileResult, exhaustedResult] = await Promise.all([
        admin.from('videos').select('youtube_video_id, video_url').eq('id', transcription.video_id).maybeSingle(),
        admin.from('transcription_parts')
          .select('position, start_seconds, end_seconds, status, attempts, last_error')
          .eq('transcription_id', transcription.id)
          .order('position', { ascending: true }),
        admin.from('transcription_profile').select('input_price_per_million, output_price_per_million').eq('id', true).maybeSingle(),
        admin.from('transcription_part_exhausted_keys')
          .select('part_position, credential_id, key_version')
          .eq('transcription_id', transcription.id),
      ])
      if (videoResult.error || partsResult.error || profileResult.error || exhaustedResult.error) {
        throw dbError('Impossibile leggere il contesto di trascrizione')
      }
      const youtubeVideoId = extractYouTubeVideoId(videoResult.data?.youtube_video_id)
        ?? extractYouTubeVideoId(videoResult.data?.video_url)
      if (!youtubeVideoId) return null

      return {
        transcriptionId: transcription.id,
        status: transcription.status as TranscriptionStatus,
        youtubeVideoId,
        model: transcription.model,
        thinkingLevel: transcription.thinking_level as ThinkingLevel,
        inputPricePerMillion: Number(profileResult.data?.input_price_per_million ?? 0.25),
        outputPricePerMillion: Number(profileResult.data?.output_price_per_million ?? 1.5),
        parts: (partsResult.data ?? []).map((part) => ({
          position: part.position,
          startSeconds: part.start_seconds,
          endSeconds: part.end_seconds,
          status: part.status,
          attempts: part.attempts,
          lastError: part.last_error,
          exhaustedKeys: (exhaustedResult.data ?? [])
            .filter((key) => key.part_position === part.position)
            .map((key) => `${key.credential_id}:${key.key_version}`),
        })),
      }
    },

    async loadCredential(input): Promise<RequesterCredentialResolution> {
      const ownerUserId = input.ownerUserId
      if (!ownerUserId) return { credential: null, channelId: input.channelId }

      let channelId = input.channelId
      if (!channelId) {
        const { data: video, error: videoError } = await admin
          .from('videos')
          .select('channel_id')
          .eq('id', input.videoId)
          .maybeSingle()
        if (videoError) throw dbError('Impossibile leggere il canale del video', videoError.message)
        channelId = video?.channel_id ?? null
      }
      // Senza un canale non è possibile verificare il follow: la chiave privata non si usa.
      if (!channelId) return { credential: null, channelId: null }

      const { data, error } = await admin.rpc(
        'transcription_eligible_credentials' as never,
        { p_channel_id: channelId } as never,
      )
      if (error) throw dbError('Impossibile verificare l idoneità del richiedente', error.message)
      const eligible = (data as Array<{ user_id: string; retry_limit: number | null }> | null)
        ?.find((row) => row.user_id === ownerUserId)
      if (!eligible) return { credential: null, channelId }

      const apiKey = await getProviderApiKeyForUserAsAdmin(ownerUserId, 'gemini').catch(() => null)
      if (!apiKey) return { credential: null, channelId }
      return { channelId, credential: { ownerUserId, apiKey, retryLimit: eligible.retry_limit ?? 0 } }
    },

    async acquireChannelCredential(input) {
      // Più tentativi solo se una chiave assegnata non è decifrabile: viene esclusa e si passa alla successiva.
      for (let attempt = 0; attempt < MAX_UNREADABLE_KEYS_PER_ACQUISITION; attempt += 1) {
        const { data, error } = await admin.rpc('claim_transcription_job_credential', {
          p_job_id: input.jobId,
          p_lease_id: input.leaseId,
          p_channel_id: input.channelId,
        })
        if (error) throw dbError('Impossibile assegnare la chiave Gemini', error.message)
        const row = data?.[0]
        if (!row) throw new AppError('Assegnazione chiave non valida', 'structural', 500)
        if (row.status !== 'assigned') return { status: row.status } as ChannelCredentialAcquisition
        if (!row.credential_id || !row.user_id || !row.key_version) throw new AppError('Assegnazione chiave non valida', 'structural', 500)

        const apiKey = await getProviderApiKeyForUserAsAdmin(row.user_id, 'gemini').catch(() => null)
        if (apiKey) {
          return {
            status: 'assigned',
            credential: {
              ownerUserId: row.user_id,
              apiKey,
              retryLimit: row.retry_limit ?? 0,
              credentialId: row.credential_id,
              keyVersion: row.key_version,
            },
          }
        }
        const transcriptionId = await readTranscriptionId(admin, input.jobId)
        if (!transcriptionId) throw new AppError('Job di trascrizione non valido', 'structural', 500)
        const released = await releaseCredential(admin, {
          jobId: input.jobId, leaseId: input.leaseId, credentialId: row.credential_id, keyVersion: row.key_version,
          status: 'ineligible', transcriptionId, partPosition: null, lastError: null,
        })
        if (!released) return { status: 'lease_lost' }
      }
      return { status: 'waiting' }
    },

    async claimPartCredential(input) {
      for (let attempt = 0; attempt < MAX_UNREADABLE_KEYS_PER_ACQUISITION; attempt += 1) {
        const { data, error } = await admin.rpc('claim_transcription_part_credential', {
          p_job_id: input.jobId,
          p_lease_id: input.leaseId,
          p_channel_id: input.channelId,
          p_transcription_id: input.transcriptionId,
          p_part_position: input.partPosition,
        })
        if (error) throw dbError('Impossibile assegnare la chiave alla parte', error.message)
        const row = data?.[0]
        if (!row) throw new AppError('Assegnazione chiave non valida', 'structural', 500)
        if (row.status === 'lease_lost') return { status: 'lease_lost' }
        if (row.status !== 'assigned') return { status: 'none' }
        if (!row.credential_id || !row.user_id || !row.key_version) throw new AppError('Assegnazione chiave non valida', 'structural', 500)

        const apiKey = await getProviderApiKeyForUserAsAdmin(row.user_id, 'gemini').catch(() => null)
        const credential = {
          ownerUserId: row.user_id,
          apiKey: apiKey ?? '',
          retryLimit: row.retry_limit ?? 0,
          credentialId: row.credential_id,
          keyVersion: row.key_version,
        }
        if (apiKey) return { status: 'assigned', credential }
        // Chiave non decifrabile: esclusa per questa parte e si prova la successiva.
        const recorded = await recordPartExhausted(admin, { ...input, credential, lastError: 'key_unreadable' })
        if (!recorded) return { status: 'lease_lost' }
      }
      return { status: 'none' }
    },

    async recordPartKeyExhausted(input) {
      return recordPartExhausted(admin, input)
    },

    async savePart(input) {
      const { data, error } = await admin.rpc('save_transcription_part', {
        p_job_id: input.jobId,
        p_lease_id: input.leaseId,
        p_transcription_id: input.transcriptionId,
        p_part_position: input.partPosition,
        p_status: input.status,
        p_attempts: input.attempts,
        p_last_error: input.lastError,
        p_language_code: input.languageCode,
        p_phrases: input.phrases,
      })
      if (error) throw dbError('Impossibile salvare la parte di trascrizione', error.message)
      return data === true
    },

    async finalize(input) {
      const { data, error } = await admin.rpc('finalize_transcription', {
        p_job_id: input.jobId,
        p_lease_id: input.leaseId,
        p_transcription_id: input.transcriptionId,
        p_close_pending: input.closePending,
      })
      if (error) throw dbError('Impossibile finalizzare la trascrizione', error.message)
      return (data as TranscriptionStatus | null) ?? null
    },

    async finishJob(input) {
      const { data, error } = await admin.rpc('finish_transcription_job_attempt', {
        p_job_id: input.jobId,
        p_lease_id: input.leaseId,
        p_attempt_id: input.attemptId,
        p_status: input.status,
        p_completed_at: input.completedAt,
        p_error_message: input.errorMessage,
        p_error_details: input.errorDetails as never,
      })
      if (error) throw dbError('Impossibile chiudere il job di trascrizione', error.message)
      return data === true
    },
  }
}

/** Confronto a tempo costante del Bearer CRON_SECRET (stesso schema degli altri endpoint cron). */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const received = Buffer.from(request.headers.get('authorization') ?? '', 'utf8')
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/**
 * Chiede la continuazione di un job rilasciato con una chiamata breve alla route interna protetta da CRON_SECRET,
 * che a sua volta lavora il job in `after()`. Se la chiamata fallisce (es. Deployment Protection) il job resta pending
 * e viene ripreso dalla richiesta successiva dell'utente o dal daily-sync.
 */
export async function requestTranscriptionContinuation(jobId: string): Promise<void> {
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  await fetch(buildSiteUrl('/api/cron/transcription-continue'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
    body: JSON.stringify({ jobId }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.body?.cancel().catch(() => undefined))
}
