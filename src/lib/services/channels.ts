/* Commento didattico:
 * Scopo del file: incapsula la logica di accesso ai dati e le operazioni di dominio, separandole dalla UI.
 * Moduli richiamati: `@/lib/supabase/server`, `@/lib/supabase/admin`, `@/lib/utils/errors`, `@/lib/utils/youtube-url`, `@/lib/types/database`
 * Flusso: Le funzioni del servizio vengono chiamate da API route o pagine server: qui avviene l'orchestrazione delle query e delle trasformazioni dati.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError } from '@/lib/utils/errors'
import { normalizeChannelUrl, parseYouTubeChannelUrl } from '@/lib/utils/youtube-url'
import type { Database } from '@/lib/types/database'
import { importChannelVideos } from '@/lib/services/videos'

type UserChannelRow = Database['public']['Tables']['user_channels']['Row']
type ChannelRow = Database['public']['Tables']['channels']['Row']
type UserChannelPreferenceRow = Database['public']['Tables']['user_channel_preferences']['Row']
type CanonicalSyncStateRow = Database['public']['Tables']['canonical_sync_state']['Row']

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
  admin: ReturnType<typeof createAdminClient>
  userId: string
  channelId: string
}): Promise<number> {
  const { data: channelVideos, error: videosError } = await params.admin
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
    const { error: upsertError } = await params.admin
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
export async function getChannelsForUser(userId: string): Promise<UserChannelListItem[]> {
  const supabase = await createClient()

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
export async function addChannelForUser(params: { userId: string; channelUrl: string; markExistingVideosAsSeen?: boolean }) {
  const parsed = parseYouTubeChannelUrl(params.channelUrl)

  if (parsed.type === 'invalid') {
    throw new AppError(
      'URL canale non valido. Usa youtube.com/@handle oppure youtube.com/channel/UC... ',
      'validation',
      400
    )
  }

  const supabase = createAdminClient()
  const fallback = buildFallbackChannel(parsed.type, parsed.value)
  let channel: ChannelRow | null = null

  // Evita duplicati su `@handle`: se esiste gia un canale attivo con lo stesso handle, riusalo.
  if (parsed.type === 'handle') {
    const { data: existingByHandle, error: byHandleError } = await supabase
      .from('channels')
      .select('*')
      .eq('handle', fallback.handle)
      .eq('status', 'active')
      .maybeSingle()

    if (byHandleError) {
      throw new AppError('Impossibile verificare canale esistente per handle', 'unknown', 500, {
        cause: byHandleError.message,
      })
    }

    channel = existingByHandle
  }

  if (!channel) {
    // Upsert canale globale: evita duplicati quando arriva gia un `UC...`.
    const { data: upsertedChannel, error: channelError } = await supabase
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
  await supabase
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

  // Prima scansione immediata best-effort:
  // il canale deve risultare aggiunto anche se la scansione fallisce.
  try {
    await requestScanNowForUser({
      userId: params.userId,
      channelId,
    })
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

    await supabase.from('app_logs').insert({
      level: 'warn',
      message: 'Canale aggiunto ma scansione iniziale fallita',
      context: {
        userId: params.userId,
        channelId,
        scanBlockedReason,
        error: initialScanError,
      },
    })
  }

  if (shouldMarkExistingVideosAsSeen) {
    markedSeenCount = await markChannelVideosSeenForUser({
      admin: supabase,
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
export async function removeChannelForUser(params: { userId: string; channelId: string }) {
  const supabase = createAdminClient()

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
 * Accoda (ed esegue subito in V1) una scansione manuale del canale.
 * Registra sempre il job in tabella per audit/diagnosi in console admin.
 */
export async function requestScanNowForUser(
  params: { userId: string; channelId: string },
  options?: {
    asAdmin?: boolean
    source?: 'manual_scan' | 'scheduled_sync'
    dedupeKey?: string
  }
) {
  const supabase = options?.asAdmin ? createAdminClient() : await createClient()

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
  const dedupeKey = options?.dedupeKey
    ?? (source === 'scheduled_sync'
      ? `scheduled_sync:${params.channelId}:${dayKey}`
      : `manual_scan:${params.userId}:${params.channelId}:${windowKey}`)

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
    },
    deduplication_key: dedupeKey,
    created_by_user_id: params.userId,
  }).select('id').single()

  // Idempotenza forte: se il job esiste gia` (dedup key), non trattare come errore.
  if (jobError?.code === '23505') {
    return { queued: false, jobId: null, deduplicated: true }
  }

  if (jobError || !jobRow) {
    throw new AppError('Impossibile schedulare la scansione', 'unknown', 500, {
      cause: jobError?.message ?? 'job_insert_failed',
    })
  }

  // In questa versione non esiste ancora un worker dedicato: eseguiamo subito il job.
  // Manteniamo comunque la riga in tabella `jobs` per tracciamento storico in admin.
  const startedAt = new Date().toISOString()
  await admin
    .from('jobs')
    .update({ status: 'running', started_at: startedAt, error_message: null })
    .eq('id', jobRow.id)

  try {
    await importChannelVideos({
      userId: params.userId,
      channelId: params.channelId,
      // Import canonico richiede scrittura su tabelle admin-only (`videos`).
      // Il controllo ownership canale e` gia` effettuato sopra.
      bypassUserChannelGuard: true,
    })

    const completedAt = new Date().toISOString()
    await admin
      .from('jobs')
      .update({ status: 'completed', completed_at: completedAt, error_message: null })
      .eq('id', jobRow.id)

    await admin.from('job_attempts').insert({
      job_id: jobRow.id,
      attempt_number: 1,
      status: 'completed',
      started_at: startedAt,
      completed_at: completedAt,
      error_message: null,
      error_details: null,
    })
  } catch (error) {
    const message = error instanceof AppError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'scan_failed'
    const details = error instanceof AppError
      ? {
        type: error.type,
        statusCode: error.statusCode ?? null,
        ...(error.context ?? {}),
      }
      : error instanceof Error
        ? { message: error.message }
        : { message: 'scan_failed' }
    const completedAt = new Date().toISOString()

    await admin
      .from('jobs')
      .update({ status: 'failed', completed_at: completedAt, error_message: message })
      .eq('id', jobRow.id)

    await admin.from('job_attempts').insert({
      job_id: jobRow.id,
      attempt_number: 1,
      status: 'failed',
      started_at: startedAt,
      completed_at: completedAt,
      error_message: message,
      error_details: details,
    })

    await admin.from('app_logs').insert({
      level: 'error',
      message: 'Job scan canale fallito',
      context: {
        jobId: jobRow.id,
        userId: params.userId,
        channelId: params.channelId,
        errorMessage: message,
        errorDetails: details,
      },
    })

    throw error
  }

  return { queued: true, jobId: jobRow.id, deduplicated: false }
}
