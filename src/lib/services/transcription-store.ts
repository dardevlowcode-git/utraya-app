/* Commento didattico:
 * Scopo del file: implementazione Supabase (service_role) del `TranscriptionStore` e continuazione dei job lunghi.
 * Moduli richiamati: client admin, servizio integrazioni (chiave Gemini decifrata solo qui), utility video id.
 * Flusso: il worker chiede claim, contesto, credenziale e salvataggi; ogni scrittura passa dalle RPC con fencing sulla lease.
 */

import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import {
  parseTranscriptionJobPayload,
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

      const [videoResult, partsResult, profileResult] = await Promise.all([
        admin.from('videos').select('youtube_video_id, video_url').eq('id', transcription.video_id).maybeSingle(),
        admin.from('transcription_parts')
          .select('position, start_seconds, end_seconds, status, attempts, last_error')
          .eq('transcription_id', transcription.id)
          .order('position', { ascending: true }),
        admin.from('transcription_profile').select('input_price_per_million, output_price_per_million').eq('id', true).maybeSingle(),
      ])
      if (videoResult.error || partsResult.error || profileResult.error) {
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
        })),
      }
    },

    async loadCredential(ownerUserId) {
      if (!ownerUserId) return null
      const { data: credential, error } = await admin
        .from('user_provider_credentials')
        .select('id, is_configured, is_valid')
        .eq('user_id', ownerUserId)
        .eq('provider', 'gemini')
        .maybeSingle()
      if (error) throw dbError('Impossibile leggere la credenziale Gemini', error.message)
      if (!credential?.is_configured || credential.is_valid === false) return null

      const [apiKey, retryResult] = await Promise.all([
        getProviderApiKeyForUserAsAdmin(ownerUserId, 'gemini').catch(() => null),
        admin.from('user_provider_credential_retry_limits').select('retry_limit').eq('credential_id', credential.id).maybeSingle(),
      ])
      if (retryResult.error) throw dbError('Impossibile leggere il limite retry', retryResult.error.message)
      if (!apiKey) return null
      return { ownerUserId, apiKey, retryLimit: retryResult.data?.retry_limit ?? 0 }
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
