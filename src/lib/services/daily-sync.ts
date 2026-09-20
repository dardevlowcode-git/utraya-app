/* Commento didattico:
 * Scopo del file: orchestrare la scansione giornaliera dei canali in modo idempotente e riusabile.
 * Moduli richiamati: `@/lib/supabase/admin`, `@/lib/services/channels`, `@/lib/utils/errors`
 * Flusso: la route cron delega qui l'esecuzione; il service seleziona canali due, applica lock/dedup, avvia scansioni e produce un riepilogo.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { requestScanNowForUser } from '@/lib/services/channels'
import { AppError } from '@/lib/utils/errors'
import type { Database } from '@/lib/types/database'

type UserChannelRow = Database['public']['Tables']['user_channels']['Row']
type UserChannelPreferenceRow = Database['public']['Tables']['user_channel_preferences']['Row']
type CredentialRow = Database['public']['Tables']['user_provider_credentials']['Row']
type CanonicalSyncStateRow = Database['public']['Tables']['canonical_sync_state']['Row']

type EligibleRelation = {
  userId: string
  channelId: string
  addedAt: string
  syncFrequencyHours: number
}

type DailySyncEnv = {
  maxChannelsPerRun: number
  timeBudgetMs: number
}

export type DailySyncResult = {
  success: boolean
  runId: string
  startedAt: string
  endedAt: string
  durationMs: number
  lockAcquired: boolean
  lockSkipped: boolean
  candidates: number
  selectedChannels: number
  attemptedChannels: number
  queuedJobs: number
  deduplicatedJobs: number
  skippedNoEligibleUser: number
  skippedByLimit: number
  timedOut: boolean
  failedChannels: number
  failures: Array<{ channelId: string; error: string }>
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function getEnvConfig(): DailySyncEnv {
  return {
    maxChannelsPerRun: readPositiveInt(process.env.DAILY_SYNC_MAX_CHANNELS_PER_RUN, 50),
    timeBudgetMs: readPositiveInt(process.env.DAILY_SYNC_TIME_BUDGET_MS, 50_000),
  }
}

function toIso(date: Date): string {
  return date.toISOString()
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + Math.max(hours, 1) * 60 * 60 * 1000)
}

export function isChannelDue(params: {
  now: Date
  syncFrequencyHours: number
  syncState: Pick<CanonicalSyncStateRow, 'last_sync_at' | 'next_sync_at'> | null
}): boolean {
  if (params.syncState?.next_sync_at) {
    return new Date(params.syncState.next_sync_at).getTime() <= params.now.getTime()
  }

  if (!params.syncState?.last_sync_at) {
    return true
  }

  const nextFromLast = addHours(new Date(params.syncState.last_sync_at), params.syncFrequencyHours)
  return nextFromLast.getTime() <= params.now.getTime()
}

export function computeNextSyncIso(now: Date, syncFrequencyHours: number): string {
  return toIso(addHours(now, syncFrequencyHours))
}

async function writeLog(
  admin: ReturnType<typeof createAdminClient>,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>
) {
  await admin.from('app_logs').insert({ level, message, context })
}

async function acquireRunLock(
  admin: ReturnType<typeof createAdminClient>,
  runId: string,
  now: Date,
  lockTtlMs: number
): Promise<boolean> {
  const lockKey = 'daily_sync:global'
  const expiresAt = new Date(now.getTime() + lockTtlMs).toISOString()

  await admin
    .from('job_locks')
    .delete()
    .eq('lock_key', lockKey)
    .lt('expires_at', now.toISOString())

  const { error } = await admin
    .from('job_locks')
    .insert({
      lock_key: lockKey,
      locked_by: runId,
      expires_at: expiresAt,
    })

  if (!error) return true
  if (error.code === '23505') return false

  throw new AppError('Impossibile acquisire lock daily sync', 'unknown', 500, { cause: error.message })
}

async function releaseRunLock(admin: ReturnType<typeof createAdminClient>, runId: string) {
  await admin
    .from('job_locks')
    .delete()
    .eq('lock_key', 'daily_sync:global')
    .eq('locked_by', runId)
}

async function loadEligibleRelations(
  admin: ReturnType<typeof createAdminClient>,
  now: Date
): Promise<{ relations: EligibleRelation[]; skippedNoEligibleUser: number }> {
  const { data: userChannels, error: userChannelsError } = await admin
    .from('user_channels')
    .select('id, user_id, channel_id, added_at')
    .eq('is_active', true)

  if (userChannelsError) {
    throw new AppError('Impossibile leggere canali utente attivi', 'unknown', 500, { cause: userChannelsError.message })
  }

  const channelRows = (userChannels ?? []) as Array<Pick<UserChannelRow, 'id' | 'user_id' | 'channel_id' | 'added_at'>>
  if (channelRows.length === 0) {
    return { relations: [], skippedNoEligibleUser: 0 }
  }

  const userChannelIds = channelRows.map((row) => row.id)
  const userIds = Array.from(new Set(channelRows.map((row) => row.user_id)))
  const channelIds = Array.from(new Set(channelRows.map((row) => row.channel_id)))

  const [{ data: preferences, error: preferencesError }, { data: credentials, error: credentialsError }, { data: syncStates, error: syncStatesError }] = await Promise.all([
    admin
      .from('user_channel_preferences')
      .select('user_channel_id, sync_frequency_hours, is_paused')
      .in('user_channel_id', userChannelIds),
    admin
      .from('user_provider_credentials')
      .select('user_id, provider, is_configured, is_valid')
      .eq('provider', 'youtube')
      .in('user_id', userIds),
    admin
      .from('canonical_sync_state')
      .select('channel_id, last_sync_at, next_sync_at')
      .in('channel_id', channelIds),
  ])

  if (preferencesError) {
    throw new AppError('Impossibile leggere preferenze canale utente', 'unknown', 500, { cause: preferencesError.message })
  }
  if (credentialsError) {
    throw new AppError('Impossibile leggere credenziali YouTube utente', 'unknown', 500, { cause: credentialsError.message })
  }
  if (syncStatesError) {
    throw new AppError('Impossibile leggere stato sync canali', 'unknown', 500, { cause: syncStatesError.message })
  }

  const prefByUserChannel = new Map<string, Pick<UserChannelPreferenceRow, 'sync_frequency_hours' | 'is_paused'>>()
  for (const pref of (preferences ?? []) as Array<Pick<UserChannelPreferenceRow, 'user_channel_id' | 'sync_frequency_hours' | 'is_paused'>>) {
    prefByUserChannel.set(pref.user_channel_id, {
      sync_frequency_hours: pref.sync_frequency_hours,
      is_paused: pref.is_paused,
    })
  }

  const credByUser = new Map<string, Pick<CredentialRow, 'is_configured' | 'is_valid'>>()
  for (const credential of (credentials ?? []) as Array<Pick<CredentialRow, 'user_id' | 'is_configured' | 'is_valid'>>) {
    if (credential.is_configured && credential.is_valid !== false) {
      credByUser.set(credential.user_id, {
        is_configured: credential.is_configured,
        is_valid: credential.is_valid,
      })
    }
  }

  const syncByChannel = new Map<string, Pick<CanonicalSyncStateRow, 'last_sync_at' | 'next_sync_at'>>()
  for (const sync of (syncStates ?? []) as Array<Pick<CanonicalSyncStateRow, 'channel_id' | 'last_sync_at' | 'next_sync_at'>>) {
    syncByChannel.set(sync.channel_id, {
      last_sync_at: sync.last_sync_at,
      next_sync_at: sync.next_sync_at,
    })
  }

  const grouped = new Map<string, EligibleRelation[]>()
  let skippedNoEligibleUser = 0

  const orderedChannels = [...channelRows].sort((a, b) => a.added_at.localeCompare(b.added_at))

  for (const relation of orderedChannels) {
    const preferencesForRelation = prefByUserChannel.get(relation.id)
    if (preferencesForRelation?.is_paused) {
      continue
    }

    if (!credByUser.has(relation.user_id)) {
      skippedNoEligibleUser += 1
      continue
    }

    const syncFrequencyHours = preferencesForRelation?.sync_frequency_hours ?? 24
    const due = isChannelDue({
      now,
      syncFrequencyHours,
      syncState: syncByChannel.get(relation.channel_id) ?? null,
    })

    if (!due) {
      continue
    }

    const current = grouped.get(relation.channel_id) ?? []
    current.push({
      userId: relation.user_id,
      channelId: relation.channel_id,
      addedAt: relation.added_at,
      syncFrequencyHours,
    })
    grouped.set(relation.channel_id, current)
  }

  const selected: EligibleRelation[] = []

  for (const [channelId, relations] of grouped.entries()) {
    const ordered = [...relations].sort((a, b) => a.addedAt.localeCompare(b.addedAt))
    const chosen = ordered[0]
    const minFrequency = relations.reduce((acc, item) => Math.min(acc, item.syncFrequencyHours), 24)

    selected.push({
      channelId,
      userId: chosen.userId,
      addedAt: chosen.addedAt,
      syncFrequencyHours: minFrequency,
    })
  }

  selected.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
  return { relations: selected, skippedNoEligibleUser }
}

export async function runDailyChannelSync(): Promise<DailySyncResult> {
  const admin = createAdminClient()
  const env = getEnvConfig()

  const startedAtDate = new Date()
  const startedAt = toIso(startedAtDate)
  const runId = `daily-sync-${startedAtDate.toISOString().replace(/[:.]/g, '-')}`

  const baseResult: Omit<DailySyncResult, 'endedAt' | 'durationMs'> = {
    success: true,
    runId,
    startedAt,
    lockAcquired: false,
    lockSkipped: false,
    candidates: 0,
    selectedChannels: 0,
    attemptedChannels: 0,
    queuedJobs: 0,
    deduplicatedJobs: 0,
    skippedNoEligibleUser: 0,
    skippedByLimit: 0,
    timedOut: false,
    failedChannels: 0,
    failures: [],
  }

  try {
    const lockAcquired = await acquireRunLock(admin, runId, startedAtDate, env.timeBudgetMs + 120_000)
    if (!lockAcquired) {
      const endedAtDate = new Date()
      return {
        ...baseResult,
        lockAcquired: false,
        lockSkipped: true,
        endedAt: toIso(endedAtDate),
        durationMs: endedAtDate.getTime() - startedAtDate.getTime(),
      }
    }

    await writeLog(admin, 'info', 'Daily channel sync started', {
      runId,
      startedAt,
      maxChannelsPerRun: env.maxChannelsPerRun,
      timeBudgetMs: env.timeBudgetMs,
    })

    const { relations, skippedNoEligibleUser } = await loadEligibleRelations(admin, startedAtDate)

    baseResult.lockAcquired = true
    baseResult.skippedNoEligibleUser = skippedNoEligibleUser
    baseResult.candidates = relations.length

    const selected = relations.slice(0, env.maxChannelsPerRun)
    baseResult.selectedChannels = selected.length
    baseResult.skippedByLimit = Math.max(relations.length - selected.length, 0)

    for (let index = 0; index < selected.length; index += 1) {
      const elapsedMs = Date.now() - startedAtDate.getTime()
      if (elapsedMs >= env.timeBudgetMs) {
        baseResult.timedOut = true
        baseResult.skippedByLimit += selected.length - index
        break
      }

      const item = selected[index]
      baseResult.attemptedChannels += 1

      try {
        const dayKey = new Date().toISOString().slice(0, 10)
        const scanResult = await requestScanNowForUser(
          { userId: item.userId, channelId: item.channelId },
          {
            asAdmin: true,
            source: 'scheduled_sync',
            dedupeKey: `scheduled_sync:${item.channelId}:${dayKey}`,
          }
        )

        if (scanResult.deduplicated) {
          baseResult.deduplicatedJobs += 1
        } else if (scanResult.queued) {
          baseResult.queuedJobs += 1
        }

        await admin
          .from('canonical_sync_state')
          .upsert(
            {
              channel_id: item.channelId,
              next_sync_at: computeNextSyncIso(new Date(), item.syncFrequencyHours),
            },
            { onConflict: 'channel_id' }
          )
      } catch (error) {
        baseResult.failedChannels += 1
        const message = error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'daily_sync_failed'

        baseResult.failures.push({ channelId: item.channelId, error: message })

        await admin
          .from('canonical_sync_state')
          .upsert(
            {
              channel_id: item.channelId,
              last_sync_status: 'failed',
              next_sync_at: computeNextSyncIso(new Date(), item.syncFrequencyHours),
            },
            { onConflict: 'channel_id' }
          )
      }
    }

    baseResult.success = baseResult.failedChannels === 0
  } finally {
    if (baseResult.lockAcquired) {
      await releaseRunLock(admin, runId)
    }
  }

  const endedAtDate = new Date()
  const durationMs = endedAtDate.getTime() - startedAtDate.getTime()

  const result: DailySyncResult = {
    ...baseResult,
    endedAt: toIso(endedAtDate),
    durationMs,
  }

  await writeLog(admin, result.success ? 'info' : 'warn', 'Daily channel sync completed', {
    runId,
    success: result.success,
    durationMs: result.durationMs,
    candidates: result.candidates,
    selectedChannels: result.selectedChannels,
    attemptedChannels: result.attemptedChannels,
    queuedJobs: result.queuedJobs,
    deduplicatedJobs: result.deduplicatedJobs,
    skippedNoEligibleUser: result.skippedNoEligibleUser,
    skippedByLimit: result.skippedByLimit,
    timedOut: result.timedOut,
    failedChannels: result.failedChannels,
    failures: result.failures,
  })

  return result
}
