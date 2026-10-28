import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import { fetchAndRecordProviderRequest } from '@/lib/services/api-usage'
import { AppError } from '@/lib/utils/errors'
import { computeRetryAt } from '@/lib/utils/retry-backoff'
import type { Json } from '@/lib/types/database'

export interface ChannelScanLease {
  jobId: string
  leaseId: string
  channelId: string
}

export interface DeferredScanDisposition {
  availableAt: string | null
  reason: 'waiting_for_credential' | 'provider_retry_backoff' | 'advance_to_next_credential' | 'provider_request_checkpoint'
}

interface ClaimProviderRequestRow {
  status: 'assigned' | 'cached' | 'waiting' | 'exhausted' | 'backoff'
  credential_id: string | null
  user_id: string | null
  key_version: string | null
  retry_limit: number | null
  attempt_number: number | null
  retry_at: string | null
  response: unknown
}

/** Rende stabile e non reversibile l'identità della richiesta senza registrare URL o query. */
function buildRequestKey(url: URL, operation: string): string {
  const safeUrl = new URL(url)
  safeUrl.searchParams.delete('key')
  return createHash('sha256').update(`${operation}\n${safeUrl.toString()}`).digest('hex')
}

/** Persiste esito, risposta canonica del job e backoff prima del rilascio della lease. */
async function finishProviderAttempt(params: {
  admin: ReturnType<typeof createAdminClient>
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
  if (error) throw new AppError('Impossibile persistere esito richiesta YouTube', 'unknown', 500, { cause: error.message })
  if (data !== true) throw new AppError('Lease job scaduta durante la richiesta YouTube', 'temporary', 409)
}

/** Riusa la risposta cache o salva una nuova risposta e sospende lo scan fino alla lease successiva. */
export async function fetchYouTubeScanJson<T>(params: {
  url: URL
  operation: string
  lease: ChannelScanLease
  fetcher?: typeof fetch
  onOwnerAssigned?: (userId: string) => void
}): Promise<T> {
  const admin = createAdminClient()
  const requestKey = buildRequestKey(params.url, params.operation)
  const { data, error } = await admin.rpc('claim_channel_scan_provider_request', {
    p_job_id: params.lease.jobId,
    p_lease_id: params.lease.leaseId,
    p_channel_id: params.lease.channelId,
    p_request_key: requestKey,
  })

  if (error) throw new AppError('Impossibile assegnare la chiave YouTube al job', 'unknown', 500, { cause: error.message })

  const attempt = (data?.[0] ?? null) as ClaimProviderRequestRow | null
  if (attempt?.status === 'cached') {
    if (attempt.user_id) params.onOwnerAssigned?.(attempt.user_id)
    return attempt.response as T
  }

  if (attempt?.status === 'waiting') {
    throw new AppError('Scansione in attesa di una chiave YouTube eleggibile', 'temporary', 409, {
      channelScanDisposition: 'waiting',
    })
  }
  if (attempt?.status === 'exhausted') {
    throw new AppError('Tutte le chiavi YouTube eleggibili sono esaurite per questo job', 'structural', 422, {
      code: 'YOUTUBE_KEYS_EXHAUSTED',
    })
  }
  if (attempt?.status === 'backoff') {
    throw new AppError('Retry YouTube pianificato', 'temporary', 409, {
      channelScanDisposition: 'deferred',
      retryAt: attempt.retry_at,
    })
  }

  if (attempt?.status !== 'assigned' || !attempt.credential_id || !attempt.user_id
      || !attempt.key_version || attempt.retry_limit === null || attempt.attempt_number === null) {
    throw new AppError('Assegnazione chiave YouTube non valida', 'structural', 500)
  }
  params.onOwnerAssigned?.(attempt.user_id)

  const apiKey = await resolveAssignedApiKey(attempt.user_id)
  const currentKeyVersion = await getCurrentKeyVersion(admin, attempt.credential_id)
  if (!apiKey || currentKeyVersion !== attempt.key_version) {
    await finishProviderAttempt({
      admin,
      lease: params.lease,
      requestKey,
      credentialId: attempt.credential_id,
      keyVersion: attempt.key_version,
      outcome: 'ineligible',
    })
    throw new AppError('Retry YouTube pianificato', 'temporary', 409, {
      channelScanDisposition: 'deferred',
      dispositionReason: 'advance_to_next_credential',
    })
  }

  let response: Response
  try {
    response = await fetchAssignedRequest({
      userId: attempt.user_id,
      url: params.url,
      operation: params.operation,
      apiKey,
      fetcher: params.fetcher,
    })
  } catch {
    const budgetExhausted = attempt.attempt_number >= attempt.retry_limit + 1
    const retryAt = budgetExhausted ? null : computeRetryAt(attempt.attempt_number, null)
    await finishProviderAttempt({
      admin,
      lease: params.lease,
      requestKey,
      credentialId: attempt.credential_id,
      keyVersion: attempt.key_version,
      outcome: 'retryable_error',
      retryAt,
    })
    throw new AppError('Retry YouTube pianificato', 'temporary', 409, {
      channelScanDisposition: 'deferred',
      retryAt,
      dispositionReason: budgetExhausted ? 'advance_to_next_credential' : 'provider_retry_backoff',
    })
  }

  if (!response.ok) {
    const budgetExhausted = attempt.attempt_number >= attempt.retry_limit + 1
    const retryAt = budgetExhausted ? null : computeRetryAt(attempt.attempt_number, response.headers.get('retry-after'))
    await finishProviderAttempt({
      admin,
      lease: params.lease,
      requestKey,
      credentialId: attempt.credential_id,
      keyVersion: attempt.key_version,
      outcome: 'retryable_error',
      retryAt,
    })
    throw new AppError('Retry YouTube pianificato', 'temporary', 409, {
      channelScanDisposition: 'deferred',
      retryAt,
      dispositionReason: budgetExhausted ? 'advance_to_next_credential' : 'provider_retry_backoff',
    })
  }

  let responseData: Json
  try {
    responseData = await response.json() as Json
  } catch {
    const budgetExhausted = attempt.attempt_number >= attempt.retry_limit + 1
    const retryAt = budgetExhausted ? null : computeRetryAt(attempt.attempt_number, null)
    await finishProviderAttempt({
      admin,
      lease: params.lease,
      requestKey,
      credentialId: attempt.credential_id,
      keyVersion: attempt.key_version,
      outcome: 'retryable_error',
      retryAt,
    })
    throw new AppError('Retry YouTube pianificato', 'temporary', 409, {
      channelScanDisposition: 'deferred',
      retryAt,
      dispositionReason: budgetExhausted ? 'advance_to_next_credential' : 'provider_retry_backoff',
    })
  }

  await finishProviderAttempt({
    admin,
    lease: params.lease,
    requestKey,
    credentialId: attempt.credential_id,
    keyVersion: attempt.key_version,
    outcome: 'success',
    response: responseData,
  })
  throw new AppError('Richiesta provider salvata; lo scan continua con una nuova lease', 'temporary', 409, {
    channelScanDisposition: 'deferred',
    dispositionReason: 'provider_request_checkpoint',
  })
}

/** Riconosce solo gli errori che devono restituire il job alla coda senza chiudere il ciclo. */
export function getDeferredScanDisposition(error: unknown): DeferredScanDisposition | null {
  if (!(error instanceof AppError)) return null
  const context = error.context
  if (!context || typeof context.channelScanDisposition !== 'string') return null
  if (context.channelScanDisposition === 'waiting') {
    return { availableAt: null, reason: 'waiting_for_credential' }
  }
  if (context.channelScanDisposition !== 'deferred') return null
  if (context.dispositionReason === 'advance_to_next_credential') {
    return { availableAt: null, reason: 'advance_to_next_credential' }
  }
  if (context.dispositionReason === 'provider_request_checkpoint') {
    return { availableAt: null, reason: 'provider_request_checkpoint' }
  }
  return {
    availableAt: typeof context.retryAt === 'string' ? context.retryAt : null,
    reason: 'provider_retry_backoff',
  }
}

/** Rilascia atomicamente la lease e rende il job nuovamente pendente con il backoff persistito. */
export async function deferScanJobAttempt(params: {
  admin: ReturnType<typeof createAdminClient>
  jobId: string
  leaseId: string
  attemptId: string
  disposition: DeferredScanDisposition
}): Promise<void> {
  const { data, error } = await params.admin.rpc('defer_scan_job_attempt', {
    p_job_id: params.jobId,
    p_lease_id: params.leaseId,
    p_attempt_id: params.attemptId,
    p_available_at: params.disposition.availableAt,
    p_reason: params.disposition.reason,
    p_completed_at: new Date().toISOString(),
  })
  if (error) throw new AppError('Impossibile pianificare il retry della scansione', 'unknown', 500, { cause: error.message })
  if (data !== true) throw new AppError('Lease job scaduta durante la pianificazione del retry', 'temporary', 409)
}

/** Risolve una chiave BYOK lato server; non restituisce né serializza il segreto nel job. */
async function resolveAssignedApiKey(userId: string): Promise<string | null> {
  return getProviderApiKeyForUserAsAdmin(userId, 'youtube')
}

/** Verifica che il segreto risolto corrisponda ancora alla versione assegnata dal claim. */
async function getCurrentKeyVersion(
  admin: ReturnType<typeof createAdminClient>,
  credentialId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from('user_provider_credential_retry_limits')
    .select('key_version')
    .eq('credential_id', credentialId)
    .maybeSingle()

  if (error) throw new AppError('Impossibile verificare la versione della chiave YouTube', 'unknown', 500, { cause: error.message })
  return data?.key_version ?? null
}

/** Esegue la chiamata associandola al proprietario della credenziale selezionata. */
async function fetchAssignedRequest(params: {
  userId: string
  url: URL
  operation: string
  apiKey: string
  fetcher?: typeof fetch
}): Promise<Response> {
  const url = new URL(params.url)
  url.searchParams.set('key', params.apiKey)
  return fetchAndRecordProviderRequest({
    userId: params.userId,
    provider: 'youtube',
    operation: params.operation,
    url: url.toString(),
    fetcher: params.fetcher,
    init: {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    },
  })
}
