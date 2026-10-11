/* Commento didattico:
 * Scopo: recupera transcript Firecrawl solo per nuovi video candidati e con controllo persistente per chiave.
 * Flusso: verifica il gate globale prima di leggere target, credenziali o contattare il provider.
 */

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAndRecordProviderRequest } from '@/lib/services/api-usage'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import { AppError } from '@/lib/utils/errors'
import type { Json } from '@/lib/types/database'
import type { ChannelScanLease } from '@/lib/services/youtube-channel-scan'

type AdminClient = ReturnType<typeof createAdminClient>
type RecoveryTarget = { channel_id: string; video_id: string; youtube_video_id: string }
type ProviderClaim = {
  status: 'assigned' | 'cached' | 'waiting' | 'exhausted' | 'backoff' | 'disabled'
  credential_id: string | null
  user_id: string | null
  key_version: string | null
  retry_limit: number | null
  attempt_number: number | null
  retry_at: string | null
  response: unknown
}

const RECOVERY_OPERATION = 'youtube.read'
const MAX_RETRY_DELAY_MS = 60_000
const RECOVERY_LEASE_STEP_REASON = 'provider_request_checkpoint'

export type FirecrawlTranscriptRecoveryResult = {
  status: 'disabled' | 'idle' | 'fetched' | 'missing' | 'skipped'
}

type TargetCompletion = { status: 'fetched' | 'missing' | 'skipped' | 'disabled'; hasPending: boolean }

type CachedTranscript = { transcriptText: string; languageCode: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Estrae solo il blocco Markdown esplicitamente intitolato Transcript; non inventa timestamp o testo. */
export function extractFirecrawlTranscript(response: unknown): CachedTranscript | null {
  if (!isRecord(response) || response.success !== true || !isRecord(response.data)) return null
  const results = response.data.alexandria
  if (!Array.isArray(results)) return null
  const result = results.find((item) => isRecord(item)
    && item.provider === 'youtube'
    && item.capability === 'read')
  if (!isRecord(result) || result.error || !isRecord(result.data)) return null
  const document = result.data.document
  if (!isRecord(document) || typeof document.markdown !== 'string') return null

  const lines = document.markdown.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => /^\s{0,3}#{1,6}\s+transcript\s*:?[ \t]*$/i.test(line))
  if (headingIndex < 0) return null
  const headingLevel = (lines[headingIndex].match(/^\s{0,3}(#{1,6})/)?.[1].length ?? 6)
  const sectionLines: string[] = []
  for (const line of lines.slice(headingIndex + 1)) {
    const nextHeading = line.match(/^\s{0,3}(#{1,6})\s+/)?.[1]
    if (nextHeading && nextHeading.length <= headingLevel) break
    sectionLines.push(line)
  }
  const transcriptText = sectionLines.join('\n').trim()
  if (!transcriptText) return null

  return { transcriptText, languageCode: 'unknown' }
}

function makeRequestKey(youtubeVideoId: string): string {
  const videoUrl = new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`)
  return createHash('sha256').update(`${RECOVERY_OPERATION}\n${videoUrl.toString()}`).digest('hex')
}

function parseCachedTranscript(value: unknown): CachedTranscript | null {
  if (!isRecord(value)
      || typeof value.transcriptText !== 'string'
      || !value.transcriptText.trim()
      || value.languageCode !== 'unknown') return null
  return { transcriptText: value.transcriptText, languageCode: value.languageCode }
}

function computeRetryAt(attemptNumber: number, retryAfter: string | null, now = Date.now()): string {
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN
  const retryAfterDate = retryAfter ? Date.parse(retryAfter) : Number.NaN
  const providerDelayMs = Number.isFinite(retryAfterSeconds)
    ? Math.max(0, retryAfterSeconds * 1000)
    : Number.isFinite(retryAfterDate)
      ? Math.max(0, retryAfterDate - now)
      : 0
  const backoffMs = Math.min(1_000 * (2 ** Math.max(attemptNumber - 1, 0)), MAX_RETRY_DELAY_MS)
  return new Date(now + Math.max(providerDelayMs, backoffMs)).toISOString()
}

async function finishProviderAttempt(params: {
  admin: AdminClient
  lease: ChannelScanLease
  requestKey: string
  credentialId: string
  keyVersion: string
  outcome: 'success' | 'retryable_error' | 'ineligible'
  response?: Json
  retryAt?: string | null
}): Promise<void> {
  const { data, error } = await params.admin.rpc('finish_channel_scan_provider_attempt', {
    p_job_id: params.lease.jobId,
    p_lease_id: params.lease.leaseId,
    p_request_key: params.requestKey,
    p_credential_id: params.credentialId,
    p_key_version: params.keyVersion,
    p_outcome: params.outcome,
    p_response: params.response ?? null,
    p_retry_at: params.retryAt ?? null,
  })
  if (error) throw new AppError('Impossibile persistere esito richiesta Firecrawl', 'unknown', 500, { cause: error.message })
  if (data !== true) throw new AppError('Lease job scaduta durante la richiesta Firecrawl', 'temporary', 409)
}

async function completeTarget(params: {
  admin: AdminClient
  lease: ChannelScanLease
  target: RecoveryTarget
  status: 'fetched' | 'missing' | 'skipped'
  transcript?: CachedTranscript | null
}): Promise<TargetCompletion> {
  const { data, error } = await params.admin.rpc('complete_firecrawl_transcript_recovery_target', {
    p_job_id: params.lease.jobId,
    p_lease_id: params.lease.leaseId,
    p_video_id: params.target.video_id,
    p_youtube_video_id: params.target.youtube_video_id,
    p_status: params.status,
    p_language_code: params.transcript?.languageCode ?? null,
    p_transcript_text: params.transcript?.transcriptText ?? null,
  })
  if (error) throw new AppError('Impossibile salvare esito Firecrawl transcript', 'unknown', 500, { cause: error.message })
  if (!isRecord(data)
      || (data.status !== 'fetched' && data.status !== 'missing' && data.status !== 'skipped' && data.status !== 'disabled')
      || typeof data.hasPending !== 'boolean') {
    throw new AppError('Lease job scaduta o target Firecrawl non disponibile', 'temporary', 409)
  }
  return { status: data.status, hasPending: data.hasPending }
}

function continueWithNextTargetIfPending(completion: TargetCompletion): void {
  if (completion.hasPending) {
    throw new AppError('Recupero Firecrawl continua con una nuova lease', 'temporary', 409, {
      channelScanDisposition: 'deferred',
      dispositionReason: RECOVERY_LEASE_STEP_REASON,
    })
  }
}

function deferredRetry(retryAt: string | null, exhausted: boolean): AppError {
  return new AppError('Retry Firecrawl pianificato', 'temporary', 409, {
    channelScanDisposition: 'deferred',
    retryAt,
    dispositionReason: exhausted ? 'advance_to_next_credential' : 'provider_retry_backoff',
  })
}

async function recordRetryableFailure(params: {
  admin: AdminClient
  lease: ChannelScanLease
  requestKey: string
  claim: ProviderClaim
  retryAfter?: string | null
}): Promise<never> {
  const attemptNumber = params.claim.attempt_number!
  const exhausted = attemptNumber >= params.claim.retry_limit! + 1
  const retryAt = exhausted ? null : computeRetryAt(attemptNumber, params.retryAfter ?? null)
  await finishProviderAttempt({
    admin: params.admin,
    lease: params.lease,
    requestKey: params.requestKey,
    credentialId: params.claim.credential_id!,
    keyVersion: params.claim.key_version!,
    outcome: 'retryable_error',
    retryAt,
  })
  throw deferredRetry(retryAt, exhausted)
}

async function resolveFirecrawlKeyVersion(admin: AdminClient, credentialId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('user_provider_credential_retry_limits')
    .select('key_version')
    .eq('credential_id', credentialId)
    .maybeSingle()
  if (error) throw new AppError('Impossibile verificare la versione della chiave Firecrawl', 'unknown', 500, { cause: error.message })
  return data?.key_version ?? null
}

async function disablePendingTargets(admin: AdminClient, jobId: string): Promise<void> {
  const { error } = await admin
    .from('channel_scan_firecrawl_transcript_targets')
    .update({ status: 'disabled' })
    .eq('job_id', jobId)
    .eq('status', 'pending')
  if (error) throw new AppError('Impossibile sospendere i target Firecrawl transcript', 'unknown', 500, { cause: error.message })
}

async function saveCachedTranscript(params: {
  admin: AdminClient
  lease: ChannelScanLease
  target: RecoveryTarget
  transcript: CachedTranscript
}): Promise<TargetCompletion> {
  return completeTarget({
    admin: params.admin,
    lease: params.lease,
    target: params.target,
    status: 'fetched',
    transcript: params.transcript,
  })
}

async function readExistingTranscript(admin: AdminClient, youtubeVideoId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('video_transcripts')
    .select('transcript_status, transcript_text')
    .eq('youtube_video_id', youtubeVideoId)
  if (error) throw new AppError('Impossibile verificare il transcript canonico', 'unknown', 500, { cause: error.message })
  return ((data ?? []) as Array<{ transcript_status: string; transcript_text: string | null }>).some(
    (row) => row.transcript_status === 'fetched' && Boolean(row.transcript_text?.trim())
  )
}

function buildProviderBody(youtubeVideoId: string): Json {
  const videoUrl = new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`)
  return {
    alexandria: {
      provider: 'youtube',
      capability: 'read',
      options: { url: videoUrl.toString(), formats: ['markdown'] },
    },
  }
}

/** Il gate separato dalla pipeline legacy e` spento se la riga manca o non vale esattamente true. */
export async function isFirecrawlTranscriptRecoveryEnabled(admin: AdminClient): Promise<boolean> {
  const { data, error } = await admin
    .from('firecrawl_transcript_recovery_settings')
    .select('enabled')
    .eq('id', true)
    .maybeSingle()

  if (error) {
    throw new AppError('Impossibile verificare il gate Firecrawl transcript', 'unknown', 500, { cause: error.message })
  }
  return data?.enabled === true
}

/** Punto di ingresso del worker: nessuna credenziale o richiesta provider viene letta con il gate chiuso. */
export async function processNextFirecrawlTranscriptRecovery(params: {
  lease: ChannelScanLease
  admin?: AdminClient
  fetcher?: typeof fetch
}): Promise<FirecrawlTranscriptRecoveryResult> {
  const admin = params.admin ?? createAdminClient()
  const enabled = await isFirecrawlTranscriptRecoveryEnabled(admin)
  if (!enabled) {
    await disablePendingTargets(admin, params.lease.jobId)
    return { status: 'disabled' }
  }

  const { data: target, error } = await admin
    .from('channel_scan_firecrawl_transcript_targets')
    .select('channel_id, video_id, youtube_video_id')
    .eq('job_id', params.lease.jobId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new AppError('Impossibile leggere i target Firecrawl transcript', 'unknown', 500, { cause: error.message })
  }
  if (!target) return { status: 'idle' }

  if (await readExistingTranscript(admin, target.youtube_video_id)) {
    const completion = await completeTarget({ admin, lease: params.lease, target, status: 'skipped' })
    continueWithNextTargetIfPending(completion)
    return { status: completion.status }
  }

  const requestKey = makeRequestKey(target.youtube_video_id)
  const { data: claimRows, error: claimError } = await admin.rpc('claim_channel_scan_provider_request', {
    p_job_id: params.lease.jobId,
    p_lease_id: params.lease.leaseId,
    p_channel_id: target.channel_id,
    p_provider: 'firecrawl',
    p_request_key: requestKey,
  })
  if (claimError) throw new AppError('Impossibile assegnare la chiave Firecrawl al job', 'unknown', 500, { cause: claimError.message })

  const claim = (claimRows?.[0] ?? null) as ProviderClaim | null
  if (claim?.status === 'disabled') {
    await disablePendingTargets(admin, params.lease.jobId)
    return { status: 'disabled' }
  }
  if (claim?.status === 'waiting') {
    throw new AppError('Recupero Firecrawl in attesa di una chiave eleggibile', 'temporary', 409, {
      channelScanDisposition: 'waiting',
    })
  }
  if (claim?.status === 'exhausted') {
    const completion = await completeTarget({ admin, lease: params.lease, target, status: 'missing' })
    if (completion.status === 'disabled') return { status: 'disabled' }
    if (completion.hasPending) continueWithNextTargetIfPending(completion)
    throw new AppError('Transcript Firecrawl non disponibile: tutte le chiavi eleggibili sono esaurite', 'structural', 422, {
      code: 'FIRECRAWL_TRANSCRIPT_UNAVAILABLE',
    })
  }
  if (claim?.status === 'backoff') throw deferredRetry(claim.retry_at, false)

  if (claim?.status === 'cached') {
    const cached = parseCachedTranscript(claim.response)
    if (!cached) {
      throw new AppError('Risposta Firecrawl persistita non valida', 'structural', 500)
    }
    const completion = await saveCachedTranscript({ admin, lease: params.lease, target, transcript: cached })
    if (completion.status === 'disabled') return { status: 'disabled' }
    continueWithNextTargetIfPending(completion)
    return { status: completion.status }
  }

  if (claim?.status !== 'assigned' || !claim.credential_id || !claim.user_id
      || !claim.key_version || claim.retry_limit === null || claim.attempt_number === null) {
    throw new AppError('Assegnazione chiave Firecrawl non valida', 'structural', 500)
  }

  const apiKey = await getProviderApiKeyForUserAsAdmin(claim.user_id, 'firecrawl')
  const currentKeyVersion = await resolveFirecrawlKeyVersion(admin, claim.credential_id)
  if (!apiKey || currentKeyVersion !== claim.key_version) {
    await finishProviderAttempt({
      admin,
      lease: params.lease,
      requestKey,
      credentialId: claim.credential_id,
      keyVersion: claim.key_version,
      outcome: 'ineligible',
    })
    throw new AppError('Retry Firecrawl pianificato', 'temporary', 409, {
      channelScanDisposition: 'deferred',
      dispositionReason: 'advance_to_next_credential',
    })
  }

  let response: Response
  try {
    response = await fetchAndRecordProviderRequest({
      userId: claim.user_id,
      provider: 'firecrawl',
      operation: RECOVERY_OPERATION,
      url: 'https://api.firecrawl.dev/v2/scrape',
      fetcher: params.fetcher,
      init: {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildProviderBody(target.youtube_video_id)),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    })
  } catch {
    return recordRetryableFailure({ admin, lease: params.lease, requestKey, claim })
  }

  if (!response.ok) {
    return recordRetryableFailure({
      admin,
      lease: params.lease,
      requestKey,
      claim,
      retryAfter: response.headers.get('retry-after'),
    })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return recordRetryableFailure({ admin, lease: params.lease, requestKey, claim })
  }
  const transcript = extractFirecrawlTranscript(body)
  if (!transcript) {
    return recordRetryableFailure({ admin, lease: params.lease, requestKey, claim })
  }

  await finishProviderAttempt({
    admin,
    lease: params.lease,
    requestKey,
    credentialId: claim.credential_id,
    keyVersion: claim.key_version,
    outcome: 'success',
    response: transcript as unknown as Json,
  })
  throw new AppError('Risposta Firecrawl salvata; il recupero continua con una nuova lease', 'temporary', 409, {
    channelScanDisposition: 'deferred',
    dispositionReason: RECOVERY_LEASE_STEP_REASON,
  })
}
