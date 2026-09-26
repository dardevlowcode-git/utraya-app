/* Commento didattico:
 * Scopo del file: incapsula la logica di accesso ai dati e le operazioni di dominio, separandole dalla UI.
 * Moduli richiamati: `@/lib/supabase/server`, `@/lib/supabase/admin`, `@/lib/utils/errors`, `@/lib/utils/youtube-url`, `@/lib/types/database`
 * Flusso: Le funzioni del servizio vengono chiamate da API route o pagine server: qui avviene l'orchestrazione delle query e delle trasformazioni dati.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError } from '@/lib/utils/errors'
import { normalizeChannelUrl, parseYouTubeChannelUrl } from '@/lib/utils/youtube-url'
import type { Database } from '@/lib/types/database'
import { importChannelVideos } from '@/lib/services/videos'
import type { AppSupabaseClient } from '@/lib/supabase/types'

type UserChannelRow = Database['public']['Tables']['user_channels']['Row']
type ChannelRow = Database['public']['Tables']['channels']['Row']
type UserChannelPreferenceRow = Database['public']['Tables']['user_channel_preferences']['Row']
type CanonicalSyncStateRow = Database['public']['Tables']['canonical_sync_state']['Row']

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export interface UserChannelListItem {
  userChannel: UserChannelRow
  channel: ChannelRow
  preferences: UserChannelPreferenceRow | null
  syncState: CanonicalSyncStateRow | null
}

export type ScanBlockedReason = 'missing_youtube_api_key'

/**
 * Riconosce il caso business in cui la scansione non puo partire
 * per mancanza credenziale YouTube dell'utente corrente.
 */
export function detectScanBlockedReasonFromError(error: unknown): ScanBlockedReason | null {
  if (!(error instanceof AppError)) return null
  if (error.type !== 'validation') return null

  const message = error.message.toLowerCase()
  if (message.includes('chiave youtube api')) {
    return 'missing_youtube_api_key'
  }

  return null
}

function chunkArray<T>(values: T[], size: number): T[][] {
  if (values.length === 0) return []

  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function markChannelVideosSeenForUser(params: {
  supabase: AppSupabaseClient
  userId: string
  channelId: string
}): Promise<number> {
  const { data: channelVideos, error: videosError } = await params.supabase
    .from('videos')
    .select('id')
    .eq('channel_id', params.channelId)

  if (videosError) {
    throw new AppError('Canale aggiunto ma stato visto/non visto non aggiornato', 'unknown', 500, {
      cause: videosError.message,
    })
  }

  const videoIds = (channelVideos ?? []).map((video) => video.id)
  if (videoIds.length === 0) {
    return 0
  }

  const seenAt = new Date().toISOString()

  for (const chunk of chunkArray(videoIds, 400)) {
    const { error: upsertError } = await params.supabase
      .from('user_video_states')
      .upsert(
        chunk.map((videoId) => ({
          user_id: params.userId,
          video_id: videoId,
          seen_status: 'seen' as const,
          seen_at: seenAt,
          hidden_at: null,
        })),
        { onConflict: 'user_id,video_id' }
      )

    if (upsertError) {
      throw new AppError('Canale aggiunto ma stato visto/non visto non aggiornato', 'unknown', 500, {
        cause: upsertError.message,
      })
    }
  }

  return videoIds.length
}

/**
 * Normalizza valori opzionali provenienti da relazioni Supabase.
 * Alcune select annidate restituiscono array, altre oggetti singoli.
 */
function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  // Uniforma il formato Supabase: alcune relazioni possono arrivare come array o singolo oggetto.
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/**
 * Genera i dati minimi necessari per creare o aggiornare un canale canonico.
 * Se l'input e` un handle, usa un id tecnico `handle:*` finche` non viene risolto in `UC...`.
 */
function buildFallbackChannel(parsedType: 'handle' | 'channel_id', parsedValue: string) {
  if (parsedType === 'channel_id') {
    return {
      youtubeChannelId: parsedValue,
      handle: null as string | null,
      title: `Canale ${parsedValue.slice(0, 8)}...`,
      customUrl: `https://www.youtube.com/channel/${parsedValue}`,
    }
  }

  const normalizedHandle = parsedValue.toLowerCase().trim()
  return {
    // Fallback temporaneo V1:
    // quando arriva solo `@handle`, salviamo un id tecnico locale (`handle:*`).
    // Sara convertito in vero `UC...` quando sara disponibile la risoluzione via API YouTube.
    youtubeChannelId: `handle:${normalizedHandle}`,
    handle: normalizedHandle,
    title: `@${normalizedHandle}`,
    customUrl: `https://www.youtube.com/@${normalizedHandle}`,
  }
}

/**
 * Restituisce l'elenco canali attivi di un utente con preferenze e stato sync.
 * Esegue la composizione in DTO per evitare logica di mapping nelle API.
 */
export async function getChannelsForUser(userId: string, client?: AppSupabaseClient): Promise<UserChannelListItem[]> {
  const supabase = client ?? await createClient()

  const { data, error } = await supabase
    .from('user_channels')
    .select(`
      *,
      channels(
        *,
        canonical_sync_state(*)
      ),
      user_channel_preferences(*)
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('added_at', { ascending: false })

  if (error) {
    throw new AppError('Impossibile caricare i canali utente', 'unknown', 500, { cause: error.message })
  }

  return (data ?? [])
    .map((row) => {
      // Compone un DTO unico per UI privata aggregando:
      // - relazione utente-canale,
      // - metadati canale,
      // - preferenze utente,
      // - stato sync canonico.
      const channel = firstOrNull((row as { channels?: ChannelRow | ChannelRow[] | null }).channels)
      if (!channel) return null

      const preferences = firstOrNull((row as { user_channel_preferences?: UserChannelPreferenceRow | UserChannelPreferenceRow[] | null }).user_channel_preferences)

      const rawSyncState = (channel as ChannelRow & {
        canonical_sync_state?: CanonicalSyncStateRow | CanonicalSyncStateRow[] | null
      }).canonical_sync_state
      const syncState = firstOrNull(rawSyncState)

      return {
        userChannel: {
          id: row.id,
          user_id: row.user_id,
          channel_id: row.channel_id,
          is_active: row.is_active,
          added_at: row.added_at,
          removed_at: row.removed_at,
        },
        channel,
        preferences,
        syncState,
      }
    })
    .filter((item): item is UserChannelListItem => item !== null)
}

/**
 * Aggiunge un canale al profilo utente.
 * Flusso: parse URL -> upsert canale canonico -> upsert relazione utente -> init preferenze -> scan iniziale.
 */
export async function addChannelForUser(params: {
  userId: string
  channelUrl: string
  markExistingVideosAsSeen?: boolean
  supabase?: AppSupabaseClient
  deferInitialScan?: boolean
}) {
  const parsed = parseYouTubeChannelUrl(params.channelUrl)

  if (parsed.type === 'invalid') {
    throw new AppError(
      'URL canale non valido. Usa youtube.com/@handle oppure youtube.com/channel/UC... ',
      'validation',
      400
    )
  }

  const supabase = params.supabase ?? await createClient()
  const admin = createAdminClient()
  const fallback = buildFallbackChannel(parsed.type, parsed.value)
  let channel: ChannelRow | null = null

  // Evita duplicati: se il canale esiste gia`, riusa la riga canonica senza
  // sovrascrivere metadati globali usando il fallback fornito dall'utente.
  if (parsed.type === 'handle') {
    const { data: existingByHandle, error: byHandleError } = await admin
      .from('channels')
      .select('*')
      .eq('handle', fallback.handle)
      .maybeSingle()

    if (byHandleError) {
      throw new AppError('Impossibile verificare canale esistente per handle', 'unknown', 500, {
        cause: byHandleError.message,
      })
    }

    channel = existingByHandle
  }

  if (!channel && parsed.type === 'channel_id') {
    const { data: existingById, error: byIdError } = await admin
      .from('channels')
      .select('*')
      .eq('youtube_channel_id', fallback.youtubeChannelId)
      .maybeSingle()
    if (byIdError) {
      throw new AppError('Impossibile verificare canale esistente per ID', 'unknown', 500, { cause: byIdError.message })
    }
    channel = existingById
  }

  if (!channel) {
    // Upsert canale globale: evita duplicati quando arriva gia un `UC...`.
    const { data: upsertedChannel, error: channelError } = await admin
      .from('channels')
      .upsert(
        {
          youtube_channel_id: fallback.youtubeChannelId,
          handle: fallback.handle,
          title: fallback.title,
          custom_url: fallback.customUrl,
          status: 'active',
        },
        { onConflict: 'youtube_channel_id' }
      )
      .select('*')
      .single()

    if (channelError || !upsertedChannel) {
      throw new AppError('Impossibile creare/aggiornare il canale', 'unknown', 500, {
        cause: channelError?.message,
      })
    }

    channel = upsertedChannel
  }
  if (!channel) {
    throw new AppError('Canale non disponibile dopo risoluzione', 'unknown', 500)
  }
  if (channel.status !== 'active') {
    const { data: reactivatedChannel, error: reactivateError } = await admin
      .from('channels')
      .update({ status: 'active' })
      .eq('id', channel.id)
      .select('*')
      .single()
    if (reactivateError || !reactivatedChannel) {
      throw new AppError('Impossibile riattivare il canale canonico', 'unknown', 500, { cause: reactivateError?.message })
    }
    channel = reactivatedChannel as ChannelRow
  }
  const channelId = channel.id

  // Upsert associazione utente<->canale: riattiva una riga esistente se era stata rimossa.
  const { data: userChannel, error: userChannelError } = await supabase
    .from('user_channels')
    .upsert(
      {
        user_id: params.userId,
        channel_id: channelId,
        is_active: true,
        removed_at: null,
      },
      { onConflict: 'user_id,channel_id' }
    )
    .select('*')
    .single()

  if (userChannelError || !userChannel) {
    throw new AppError("Impossibile associare il canale all'utente", 'unknown', 500, {
      cause: userChannelError?.message,
    })
  }

  // Inizializza preferenze minime per permettere sync periodica.
  const { error: preferenceError } = await supabase
    .from('user_channel_preferences')
    .upsert(
      {
        user_channel_id: userChannel.id,
        sync_frequency_hours: 24,
        is_paused: false,
      },
      { onConflict: 'user_channel_id' }
    )

  if (preferenceError) {
    throw new AppError('Canale aggiunto ma preferenze non inizializzate', 'unknown', 500, {
      cause: preferenceError.message,
    })
  }

  // Garantisce presenza dello stato sync canonico (una riga per canale globale).
  await admin
    .from('canonical_sync_state')
    .upsert(
      {
        channel_id: channelId,
      },
      { onConflict: 'channel_id' }
    )

  const normalized = normalizeChannelUrl(parsed)

  let initialScanError: string | null = null
  let scanBlockedReason: ScanBlockedReason | null = null
  const shouldMarkExistingVideosAsSeen = params.markExistingVideosAsSeen ?? true
  let markedSeenCount = 0

  if (!params.deferInitialScan) {
    // Prima scansione immediata best-effort: il canale resta aggiunto se fallisce.
    try {
      await requestScanNowForUser({
        userId: params.userId,
        channelId,
      }, { supabase: params.supabase })
    } catch (error) {
      const blockedReason = detectScanBlockedReasonFromError(error)
      if (blockedReason) {
        scanBlockedReason = blockedReason
      } else {
        initialScanError = error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'scan_failed'
      }

      await admin.from('app_logs').insert({
        level: 'warn',
        message: 'Canale aggiunto ma scansione iniziale fallita',
        context: {
          userIdHash: hashIdentifier(params.userId),
          channelId,
          scanBlockedReason,
          error: initialScanError,
        },
      })
    }
  }

  if (shouldMarkExistingVideosAsSeen) {
    markedSeenCount = await markChannelVideosSeenForUser({
      supabase,
      userId: params.userId,
      channelId,
    })
  }

  return {
    channelId,
    normalizedChannelUrl: normalized,
    initialScanError,
    scanBlockedReason,
    markedSeenCount,
  }
}

/**
 * Rimuove il collegamento utente-canale e pulisce i riferimenti utente al suo contenuto.
 * Mantiene il comportamento idempotente: se gia` non attivo ritorna `alreadyRemoved: true`.
 */
export async function removeChannelForUser(params: { userId: string; channelId: string; supabase?: AppSupabaseClient }) {
  const supabase = params.supabase ?? await createClient()

  const { data: userChannel, error: lookupError } = await supabase
    .from('user_channels')
    .select('id, is_active')
    .eq('user_id', params.userId)
    .eq('channel_id', params.channelId)
    .single()

  if (lookupError || !userChannel) {
    throw new AppError('Canale non trovato per questo utente', 'not_found', 404, {
      cause: lookupError?.message,
    })
  }

  const wasAlreadyRemoved = !userChannel.is_active

  const { data: channelVideos, error: channelVideosError } = await supabase
    .from('videos')
    .select('id')
    .eq('channel_id', params.channelId)

  if (channelVideosError) {
    throw new AppError('Impossibile rimuovere i riferimenti video del canale', 'unknown', 500, {
      cause: channelVideosError.message,
    })
  }

  const videoIds = (channelVideos ?? []).map((video) => video.id)

  if (videoIds.length > 0) {
    for (const chunk of chunkArray(videoIds, 400)) {
      const { error: deleteSeenError } = await supabase
        .from('user_video_states')
        .delete()
        .eq('user_id', params.userId)
        .in('video_id', chunk)

      if (deleteSeenError) {
        throw new AppError('Impossibile pulire lo stato visto/non visto del canale', 'unknown', 500, {
          cause: deleteSeenError.message,
        })
      }
    }
  }

  const { data: userWatchlists, error: watchlistsError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', params.userId)

  if (watchlistsError) {
    throw new AppError('Impossibile leggere le watchlist utente', 'unknown', 500, {
      cause: watchlistsError.message,
    })
  }

  const watchlistIds = (userWatchlists ?? []).map((watchlist) => watchlist.id)
  if (watchlistIds.length > 0 && videoIds.length > 0) {
    for (const watchlistChunk of chunkArray(watchlistIds, 200)) {
      for (const videoChunk of chunkArray(videoIds, 200)) {
        const { error: deleteWatchlistError } = await supabase
          .from('watchlist_items')
          .delete()
          .in('watchlist_id', watchlistChunk)
          .in('video_id', videoChunk)

        if (deleteWatchlistError) {
          throw new AppError('Impossibile pulire la watchlist del canale', 'unknown', 500, {
            cause: deleteWatchlistError.message,
          })
        }
      }
    }
  }

  const { error: preferenceDeleteError } = await supabase
    .from('user_channel_preferences')
    .delete()
    .eq('user_channel_id', userChannel.id)

  if (preferenceDeleteError) {
    throw new AppError('Impossibile rimuovere le preferenze del canale', 'unknown', 500, {
      cause: preferenceDeleteError.message,
    })
  }

  const { error: removeError } = await supabase
    .from('user_channels')
    .delete()
    .eq('id', userChannel.id)

  if (removeError) {
    throw new AppError('Impossibile rimuovere il canale', 'unknown', 500, {
      cause: removeError.message,
    })
  }

  return { alreadyRemoved: wasAlreadyRemoved }
}

/**
 * Accoda ed esegue una scansione manuale mantenendo il job per audit/diagnosi.
 */
export async function requestScanNowForUser(
  params: { userId: string; channelId: string },
  options?: {
    asAdmin?: boolean
    source?: 'manual_scan' | 'scheduled_sync' | 'import_channel' | 'add_channel'
    dedupeKey?: string
    maxResults?: number
    supabase?: AppSupabaseClient
  }
) {
  const queued = await enqueueScanJobForUser(params, options)
  if (queued.deduplicated || !queued.jobId) return queued
  await runScanJob({ ...params, jobId: queued.jobId, maxResults: options?.maxResults })
  return queued
}

export async function enqueueScanJobForUser(
  params: { userId: string; channelId: string },
  options?: {
    asAdmin?: boolean
    source?: 'manual_scan' | 'scheduled_sync' | 'import_channel' | 'add_channel'
    dedupeKey?: string
    maxResults?: number
    supabase?: AppSupabaseClient
  }
) {
  const supabase = options?.asAdmin ? createAdminClient() : options?.supabase ?? await createClient()

  const { data: userChannel, error: userChannelError } = await supabase
    .from('user_channels')
    .select('id')
    .eq('user_id', params.userId)
    .eq('channel_id', params.channelId)
    .eq('is_active', true)
    .single()

  if (userChannelError || !userChannel) {
    throw new AppError('Canale non disponibile per la scansione', 'forbidden', 403, {
      cause: userChannelError?.message,
    })
  }

  const admin = createAdminClient()
  const source = options?.source ?? 'manual_scan'
  const windowKey = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const dayKey = new Date().toISOString().slice(0, 10)
  const clientKey = options?.dedupeKey?.trim()
  if (clientKey && !/^[A-Za-z0-9._:-]{1,128}$/.test(clientKey)) {
    throw new AppError('Idempotency-Key non valida', 'validation', 400)
  }
  const rawKey = clientKey
    ?? (source === 'scheduled_sync' ? `${source}:${dayKey}` : `${source}:${windowKey}`)
  const dedupeKey = `v1:${source}:${params.userId}:${params.channelId}:${rawKey}`

  // Chiave dedup con finestra temporale: permette scansioni ripetute,
  // ma evita spam di job multipli nello stesso minuto.
  const { data: jobRow, error: jobError } = await admin.from('jobs').insert({
    job_type: 'sync_channel_delta',
    status: 'pending',
    priority: 3,
    payload: {
      channelId: params.channelId,
      userId: params.userId,
      source,
      maxResults: options?.maxResults ?? null,
    },
    deduplication_key: dedupeKey,
    created_by_user_id: params.userId,
  }).select('id').single()

  // Idempotenza forte: se il job esiste gia` (dedup key), non trattare come errore.
  if (jobError?.code === '23505') {
    const { data: existingJob, error: existingJobError } = await admin
      .from('jobs')
      .select('id')
      .eq('deduplication_key', dedupeKey)
      .eq('created_by_user_id', params.userId)
      .maybeSingle()
    if (existingJobError) throw new AppError('Impossibile leggere job duplicato', 'unknown', 500, { cause: existingJobError.message })
    return { queued: false, jobId: existingJob?.id ?? null, deduplicated: true }
  }

  if (jobError || !jobRow) {
    throw new AppError('Impossibile schedulare la scansione', 'unknown', 500, {
      cause: jobError?.message ?? 'job_insert_failed',
    })
  }

  return { queued: true, jobId: jobRow.id, deduplicated: false }
}

export async function runScanJob(params: { userId: string; channelId: string; jobId: string; maxResults?: number }) {
  const admin = createAdminClient()
  const startedAt = new Date().toISOString()
  const leaseId = randomUUID()
  const leaseExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const { data: claimed, error: claimError } = await admin
    .from('jobs')
    .update({ status: 'running', started_at: startedAt, lease_id: leaseId, lease_expires_at: leaseExpiresAt, error_message: null })
    .eq('id', params.jobId)
    .eq('status', 'pending')
    .select('id, lease_id')
    .maybeSingle()
  if (claimError) throw new AppError('Impossibile acquisire job scansione', 'unknown', 500, { cause: claimError.message })
  if (!claimed) return { claimed: false }

  const { data: lastAttempt, error: attemptLookupError } = await admin
    .from('job_attempts')
    .select('attempt_number')
    .eq('job_id', params.jobId)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (attemptLookupError) throw new AppError('Impossibile leggere tentativi job', 'unknown', 500, { cause: attemptLookupError.message })
  const attemptNumber = (lastAttempt?.attempt_number ?? 0) + 1

  let operationError: unknown = null
  try {
    await importChannelVideos({
      userId: params.userId,
      channelId: params.channelId,
      lease: { jobId: params.jobId, leaseId },
      // Import canonico richiede scrittura su tabelle admin-only (`videos`).
      // Il controllo ownership canale e` gia` effettuato sopra.
      bypassUserChannelGuard: true,
      maxResults: params.maxResults,
    })
  } catch (error) {
    operationError = error
  }

  if (operationError) {
    const message = operationError instanceof AppError
      ? operationError.message
      : operationError instanceof Error
        ? operationError.message
        : 'scan_failed'
    const details = operationError instanceof AppError
      ? { type: operationError.type, statusCode: operationError.statusCode ?? null, ...(operationError.context ?? {}) }
      : operationError instanceof Error ? { message: operationError.message } : { message: 'scan_failed' }
    const completedAt = new Date().toISOString()
    const { data: failedJob, error: failedJobError } = await admin
      .from('jobs')
      .update({ status: 'failed', completed_at: completedAt, lease_id: null, lease_expires_at: null, error_message: message })
      .eq('id', params.jobId)
      .eq('lease_id', leaseId)
      .gt('lease_expires_at', new Date().toISOString())
      .select('id')
      .maybeSingle()
    if (!failedJob && !failedJobError) throw new AppError('Lease job scaduta durante la scansione', 'temporary', 409)

    const { error: failedAttemptError } = await admin.from('job_attempts').insert({
      job_id: params.jobId,
      attempt_number: attemptNumber,
      status: 'failed',
      started_at: startedAt,
      completed_at: completedAt,
      error_message: message,
      error_details: details,
    })

    const { error: logError } = await admin.from('app_logs').insert({
      level: 'error',
      message: 'Job scan canale fallito',
      context: {
        jobId: params.jobId,
        userIdHash: hashIdentifier(params.userId),
        channelId: params.channelId,
        errorType: operationError instanceof AppError ? operationError.type : 'unknown',
        errorMessage: message.slice(0, 200),
      },
    })

    if (failedJobError || failedAttemptError || logError) {
      throw new AppError('Impossibile persistere esito errore scansione', 'unknown', 500, {
        cause: failedJobError?.message ?? failedAttemptError?.message ?? logError?.message,
      })
    }

    throw operationError
  }

  const completedAt = new Date().toISOString()
  const { data: completedJob, error: completedError } = await admin
    .from('jobs')
    .update({ status: 'completed', completed_at: completedAt, lease_id: null, lease_expires_at: null, error_message: null })
    .eq('id', params.jobId)
    .eq('lease_id', leaseId)
    .gt('lease_expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  if (completedError) throw new AppError('Impossibile chiudere job scansione', 'unknown', 500, { cause: completedError.message })
  if (!completedJob) throw new AppError('Lease job scaduta durante la scansione', 'temporary', 409)

  const { error: attemptError } = await admin.from('job_attempts').insert({
    job_id: params.jobId,
    attempt_number: attemptNumber,
    status: 'completed',
    started_at: startedAt,
    completed_at: completedAt,
    error_message: null,
    error_details: null,
  })
  if (attemptError) {
    const { error: auditLogError } = await admin.from('app_logs').insert({
      level: 'error',
      message: 'Job completato ma audit attempt non persistito',
      context: { jobId: params.jobId, error: attemptError.message },
    })
    if (auditLogError) throw new AppError('Impossibile persistere audit job completato', 'unknown', 500, { cause: auditLogError.message })
    throw new AppError('Impossibile registrare esito scansione', 'unknown', 500, { cause: attemptError.message })
  }

  return { claimed: true }
}

export async function processPendingScanJobs(limit = 5): Promise<{ processed: number; failed: number }> {
  const admin = createAdminClient()
  const safeLimit = Math.min(Math.max(limit, 1), 20)
  const now = new Date()
  const nowIso = now.toISOString()
  const legacyCutoffIso = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
  const [{ data: pending, error: pendingError }, { data: running, error: runningError }] = await Promise.all([
    admin
      .from('jobs')
      .select('id, payload, lease_id, lease_expires_at')
      .eq('job_type', 'sync_channel_delta')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(safeLimit),
    admin
      .from('jobs')
      .select('id, payload, lease_id, lease_expires_at, started_at')
      .eq('job_type', 'sync_channel_delta')
      .eq('status', 'running')
      .lt('lease_expires_at', nowIso)
      .order('started_at', { ascending: true })
      .limit(safeLimit),
  ])
  if (pendingError || runningError) {
    throw new AppError('Impossibile leggere job scansione pendenti', 'unknown', 500, { cause: pendingError?.message ?? runningError?.message })
  }

  const { data: legacyRunning, error: legacyError } = await admin
    .from('jobs')
    .select('id, payload, lease_id, lease_expires_at, started_at')
    .eq('job_type', 'sync_channel_delta')
    .eq('status', 'running')
    .is('lease_id', null)
    .is('lease_expires_at', null)
    .lt('started_at', legacyCutoffIso)
    .order('started_at', { ascending: true })
    .limit(safeLimit)
  if (legacyError) throw new AppError('Impossibile leggere job legacy senza lease', 'unknown', 500, { cause: legacyError.message })

  for (const item of [...(running ?? []), ...(legacyRunning ?? [])]) {
    if (!item.lease_id) {
      const { error: legacyRequeueError } = await admin
        .from('jobs')
        .update({ status: 'pending', started_at: null, lease_id: null, lease_expires_at: null, error_message: 'requeued_without_lease' })
        .eq('id', item.id)
        .eq('status', 'running')
        .is('lease_id', null)
        .is('lease_expires_at', null)
        .lt('started_at', legacyCutoffIso)
      if (legacyRequeueError) throw new AppError('Impossibile recuperare job senza lease', 'unknown', 500, { cause: legacyRequeueError.message })
      continue
    }
    const { error: requeueError } = await admin
      .from('jobs')
      .update({ status: 'pending', started_at: null, lease_id: null, lease_expires_at: null, error_message: 'requeued_after_timeout' })
      .eq('id', item.id)
      .eq('status', 'running')
      .eq('lease_id', item.lease_id)
    if (requeueError) throw new AppError('Impossibile recuperare job scansione bloccato', 'unknown', 500, { cause: requeueError.message })
  }
  // Il limite e` globale: le query separate servono a distinguere le lease,
  // ma non devono triplicare il budget di un singolo giro cron.
  const data = [...(pending ?? []), ...(running ?? []), ...(legacyRunning ?? [])].slice(0, safeLimit)

  let processed = 0
  let failed = 0
  for (const item of data ?? []) {
    const payload = item.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      const { error: invalidPayloadError } = await admin.from('jobs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: 'invalid_payload' }).eq('id', item.id).eq('status', 'pending')
      if (invalidPayloadError) throw new AppError('Impossibile chiudere job con payload non valido', 'unknown', 500, { cause: invalidPayloadError.message })
      failed += 1
      continue
    }
    const userId = typeof payload.userId === 'string' ? payload.userId : null
    const channelId = typeof payload.channelId === 'string' ? payload.channelId : null
    const maxResults = typeof payload.maxResults === 'number' && Number.isInteger(payload.maxResults)
      ? Math.min(Math.max(payload.maxResults, 1), 50)
      : undefined
    if (!userId || !channelId) {
      const { error: invalidPayloadError } = await admin.from('jobs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: 'invalid_payload' }).eq('id', item.id).eq('status', 'pending')
      if (invalidPayloadError) throw new AppError('Impossibile chiudere job con payload non valido', 'unknown', 500, { cause: invalidPayloadError.message })
      failed += 1
      continue
    }
    try {
      const result = await runScanJob({ userId, channelId, jobId: item.id, maxResults })
      if (result.claimed) processed += 1
    } catch {
      failed += 1
    }
  }
  return { processed, failed }
}
