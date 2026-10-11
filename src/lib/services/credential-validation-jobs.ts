/* Commento didattico:
 * Scopo del file: orchestra job persistenti di verifica credenziali usando lease e job_attempts esistenti.
 * Moduli richiamati: client Supabase admin, UUID e errori applicativi.
 * Flusso: una lease esegue al massimo una richiesta provider; retry e backoff restano salvati nel job.
 */

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError } from '@/lib/utils/errors'
import type { AppSupabaseClient } from '@/lib/supabase/types'

export const CREDENTIAL_VALIDATION_JOB_TYPE = 'validate_provider_credential'
export const CREDENTIAL_VALIDATION_WORKER_BATCH_LIMIT = 3
export const CREDENTIAL_VALIDATION_LEASE_MS = 60_000

const RETRY_BACKOFF_BASE_MS = 1_000
const RETRY_BACKOFF_MAX_MS = 60_000

type AdminClient = ReturnType<typeof createAdminClient>
export type ValidationProvider = 'youtube' | 'gemini' | 'firecrawl'
export type CredentialValidationStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface CredentialValidationJobPayload {
  credentialId: string
  userId: string
  provider: ValidationProvider
  keyVersion: string
  retryLimit: number
}

export interface CredentialValidationAttemptResult {
  isValid: boolean
  retryable: boolean
  message: string | null
  errorType: 'temporary' | 'structural' | null
  credentialChanged: boolean
}

interface CredentialValidationClaim {
  job_id: string
  lease_id: string
  attempt_id: string
  attempt_number: number | string
  payload: unknown
}

/** Accoda o riusa la verifica attiva della stessa versione di credenziale. */
export async function enqueueCredentialValidation(
  payload: CredentialValidationJobPayload,
  adminClient: AdminClient = createAdminClient()
): Promise<{ jobId: string; status: 'pending' | 'running' }> {
  const validatedPayload = parseCredentialValidationPayload(payload)
  const readActiveJob = async () => adminClient
    .from('jobs')
    .select('id, status')
    .eq('job_type', CREDENTIAL_VALIDATION_JOB_TYPE)
    .eq('created_by_user_id', validatedPayload.userId)
    .in('status', ['pending', 'running'])
    .contains('payload', {
      credentialId: validatedPayload.credentialId,
      keyVersion: validatedPayload.keyVersion,
    })
    .maybeSingle()

  const { data: existing, error: readError } = await readActiveJob()
  if (readError) throw new AppError('Impossibile leggere job di validazione attivo', 'unknown', 500, { cause: readError.message })
  if (existing) return { jobId: existing.id, status: existing.status as 'pending' | 'running' }

  const { data: created, error: insertError } = await adminClient
    .from('jobs')
    .insert({
      job_type: CREDENTIAL_VALIDATION_JOB_TYPE,
      status: 'pending',
      priority: 3,
      payload: validatedPayload,
      deduplication_key: `credential-validation:${randomUUID()}`,
      created_by_user_id: validatedPayload.userId,
      next_attempt_at: new Date().toISOString(),
    })
    .select('id, status')
    .single()

  if (insertError?.code === '23505') {
    const { data: raced, error: raceError } = await readActiveJob()
    if (raceError) throw new AppError('Impossibile leggere job di validazione duplicato', 'unknown', 500, { cause: raceError.message })
    if (raced) return { jobId: raced.id, status: raced.status as 'pending' | 'running' }
  }
  if (insertError || !created) {
    throw new AppError('Impossibile accodare la validazione credenziale', 'unknown', 500, { cause: insertError?.message })
  }
  return { jobId: created.id, status: 'pending' }
}

/** Restituisce lo stato attivo solo quando il job riguarda la versione attuale della chiave. */
export async function getCredentialValidationStatusesForUser(
  userId: string,
  supabase: AppSupabaseClient,
  keyVersions: ReadonlyMap<string, string>
): Promise<Map<string, 'pending' | 'running'>> {
  const statuses = new Map<string, 'pending' | 'running'>()
  if (keyVersions.size === 0) return statuses

  const { data, error } = await supabase
    .from('jobs')
    .select('payload, status')
    .eq('job_type', CREDENTIAL_VALIDATION_JOB_TYPE)
    .eq('created_by_user_id', userId)
    .in('status', ['pending', 'running'])

  if (error) throw new AppError('Impossibile leggere stato validazione credenziali', 'unknown', 500, { cause: error.message })
  for (const job of data ?? []) {
    const payload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
      ? job.payload as Record<string, unknown>
      : null
    const credentialId = typeof payload?.credentialId === 'string' ? payload.credentialId : null
    const keyVersion = typeof payload?.keyVersion === 'string' ? payload.keyVersion : null
    if (!credentialId || !keyVersion || keyVersions.get(credentialId) !== keyVersion) continue
    if (job.status === 'pending' || job.status === 'running') statuses.set(credentialId, job.status)
  }
  return statuses
}

/** Decodifica il payload persistito senza mai ammettere materiale segreto nel job. */
function parseCredentialValidationPayload(value: unknown): CredentialValidationJobPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('Payload validazione credenziale non valido', 'structural', 500)
  }

  const payload = value as Record<string, unknown>
  if (
    typeof payload.credentialId !== 'string'
    || typeof payload.userId !== 'string'
    || (payload.provider !== 'youtube' && payload.provider !== 'gemini' && payload.provider !== 'firecrawl')
    || typeof payload.keyVersion !== 'string'
    || typeof payload.retryLimit !== 'number'
    || !Number.isSafeInteger(payload.retryLimit)
    || payload.retryLimit < 0
    || payload.retryLimit > 2_147_483_647
  ) {
    throw new AppError('Payload validazione credenziale non valido', 'structural', 500)
  }

  return {
    credentialId: payload.credentialId,
    userId: payload.userId,
    provider: payload.provider as ValidationProvider,
    keyVersion: payload.keyVersion,
    retryLimit: payload.retryLimit,
  }
}

/** Calcola il backoff di una richiesta retryable da persistere in `jobs.next_attempt_at`. */
function getRetryDelayMs(attemptNumber: number): number {
  return Math.min(RETRY_BACKOFF_BASE_MS * 2 ** Math.max(attemptNumber - 1, 0), RETRY_BACKOFF_MAX_MS)
}

/** Esegue un singolo tentativo protetto da lease e persiste la transizione prima di ritornare. */
export async function processCredentialValidationJob(params: {
  jobId: string
  attemptProvider: (payload: CredentialValidationJobPayload) => Promise<CredentialValidationAttemptResult>
  adminClient?: AdminClient
  now?: Date
  clock?: () => Date
  leaseId?: string
}): Promise<{ claimed: boolean; status: CredentialValidationStatus | 'superseded'; attemptNumber?: number }> {
  const admin = params.adminClient ?? createAdminClient()
  const clock = params.clock ?? (params.now ? () => params.now as Date : () => new Date())
  const startedAt = clock()
  const leaseId = params.leaseId ?? randomUUID()
  const leaseExpiresAt = new Date(startedAt.getTime() + CREDENTIAL_VALIDATION_LEASE_MS)
  const { data, error } = await admin.rpc('claim_credential_validation_job_with_attempt', {
    p_job_id: params.jobId,
    p_started_at: startedAt.toISOString(),
    p_lease_id: leaseId,
    p_lease_expires_at: leaseExpiresAt.toISOString(),
  })

  if (error) throw new AppError('Impossibile acquisire job di validazione', 'unknown', 500, { cause: error.message })
  const claim = (Array.isArray(data) ? data[0] : null) as CredentialValidationClaim | undefined
  if (!claim) return { claimed: false, status: 'pending' }

  const payload = parseCredentialValidationPayload(claim.payload)
  const attemptNumber = Number(claim.attempt_number)
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new AppError('Numero attempt validazione non valido', 'structural', 500)
  }

  const result = await params.attemptProvider(payload)
  const retry = result.retryable && !result.credentialChanged && attemptNumber <= payload.retryLimit
  const completedAt = clock()
  const nextAttemptAt = retry
    ? new Date(completedAt.getTime() + getRetryDelayMs(attemptNumber)).toISOString()
    : null
  const status: CredentialValidationStatus = retry ? 'pending' : result.isValid ? 'completed' : 'failed'

  const { data: finished, error: finishError } = await admin.rpc('finish_credential_validation_job_attempt', {
    p_job_id: claim.job_id,
    p_lease_id: claim.lease_id,
    p_attempt_id: claim.attempt_id,
    p_attempt_number: attemptNumber,
    p_retry_limit: payload.retryLimit,
    p_status: status,
    p_completed_at: completedAt.toISOString(),
    p_next_attempt_at: nextAttemptAt,
    p_is_valid: result.isValid,
    p_error_message: result.message,
    p_error_type: result.errorType,
    p_credential_changed: result.credentialChanged,
  })

  if (finishError) throw new AppError('Impossibile salvare esito job di validazione', 'unknown', 500, { cause: finishError.message })
  if (!finished) return { claimed: true, status: 'superseded', attemptNumber }
  return { claimed: true, status, attemptNumber }
}

/** Lavora un numero tecnico limitato di job per tick; ogni job fa al massimo una richiesta provider. */
export async function processPendingCredentialValidationJobs(params: {
  attemptProvider: (payload: CredentialValidationJobPayload) => Promise<CredentialValidationAttemptResult>
  adminClient?: AdminClient
  now?: Date
  clock?: () => Date
  batchLimit?: number
}): Promise<{ claimed: number; completed: number; pending: number; failed: number }> {
  const admin = params.adminClient ?? createAdminClient()
  const clock = params.clock ?? (params.now ? () => params.now as Date : () => new Date())
  const now = clock()
  const nowIso = now.toISOString()
  const batchLimit = Math.min(Math.max(params.batchLimit ?? CREDENTIAL_VALIDATION_WORKER_BATCH_LIMIT, 1), CREDENTIAL_VALIDATION_WORKER_BATCH_LIMIT)
  const [pendingResult, expiredResult] = await Promise.all([
    admin.from('jobs')
      .select('id')
      .eq('job_type', CREDENTIAL_VALIDATION_JOB_TYPE)
      .eq('status', 'pending')
      .lte('next_attempt_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(batchLimit),
    admin.from('jobs')
      .select('id')
      .eq('job_type', CREDENTIAL_VALIDATION_JOB_TYPE)
      .eq('status', 'running')
      .lt('lease_expires_at', nowIso)
      .order('started_at', { ascending: true })
      .limit(batchLimit),
  ])
  if (pendingResult.error || expiredResult.error) {
    throw new AppError('Impossibile caricare job di validazione', 'unknown', 500, {
      cause: pendingResult.error?.message ?? expiredResult.error?.message,
    })
  }

  const candidates = Array.from(new Set([
    ...(expiredResult.data ?? []).map((job) => job.id),
    ...(pendingResult.data ?? []).map((job) => job.id),
  ])).slice(0, batchLimit)
  const results = await Promise.allSettled(candidates.map((jobId) => processCredentialValidationJob({
    jobId,
    attemptProvider: params.attemptProvider,
    adminClient: admin,
    clock,
  })))

  return {
    claimed: results.filter((result) => result.status === 'fulfilled' && result.value.claimed).length,
    completed: results.filter((result) => result.status === 'fulfilled' && result.value.status === 'completed').length,
    pending: results.filter((result) => result.status === 'fulfilled' && result.value.status === 'pending').length,
    failed: results.filter((result) => result.status === 'rejected'
      || (result.status === 'fulfilled' && result.value.status === 'failed')).length,
  }
}
