/* Commento didattico:
 * Scopo del file: incapsula la logica di accesso ai dati e le operazioni di dominio, separandole dalla UI.
 * Moduli richiamati: `@/lib/supabase/server`, `@/lib/utils/errors`, `@/lib/types/domain`, `@/lib/types/database`, `@/lib/services/integrations`
 * Flusso: Le funzioni del servizio vengono chiamate da API route o pagine server: qui avviene l'orchestrazione delle query e delle trasformazioni dati.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError } from '@/lib/utils/errors'
import type { VideoWithContext } from '@/lib/types/domain'
import type { Database, Json } from '@/lib/types/database'
import { getProviderApiKeyForUser, getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import { parseYouTubeDurationToSeconds } from '@/lib/utils/video-duration'

type AnalysisStatus = Database['public']['Tables']['video_analysis']['Row']['analysis_status']

export interface GetVideosForUserParams {
  userId: string
  channelId?: string
  analysisStatus?: AnalysisStatus
  seenStatus?: 'seen' | 'unseen' | 'hidden'
  onlyWatchlist?: boolean
  search?: string
  languageCode?: string
  limit?: number
  page?: number
}

export interface VideoListResponse {
  items: VideoWithContext[]
  page: number
  limit: number
  total: number
}

/**
 * Aggiorna lo stato visto/non visto di un video per l'utente.
 */
export async function setVideoSeenStatusForUser(params: {
  userId: string
  videoId: string
  seenStatus: 'seen' | 'unseen' | 'hidden'
}): Promise<{ seenStatus: 'seen' | 'unseen' | 'hidden'; seenAt: string | null; hiddenAt: string | null }> {
  const supabase = await createClient()
  const now = new Date().toISOString()
  const seenAt = params.seenStatus === 'seen' ? now : null
  const hiddenAt = params.seenStatus === 'hidden' ? now : null

  const { error } = await supabase
    .from('user_video_states')
    .upsert(
      {
        user_id: params.userId,
        video_id: params.videoId,
        seen_status: params.seenStatus,
        seen_at: seenAt,
        hidden_at: hiddenAt,
      },
      { onConflict: 'user_id,video_id' }
    )

  if (error) {
    throw new AppError('Impossibile aggiornare stato visto', 'unknown', 500, { cause: error.message })
  }

  return { seenStatus: params.seenStatus, seenAt, hiddenAt }
}

/**
 * Aggiorna appartenenza del video alla watchlist di default dell'utente.
 */
export async function setVideoWatchlistForUser(params: {
  userId: string
  videoId: string
  inWatchlist: boolean
}): Promise<{ isInWatchlist: boolean }> {
  const supabase = await createClient()

  const { data: existingWatchlist, error: watchlistReadError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', params.userId)
    .eq('is_default', true)
    .maybeSingle()

  if (watchlistReadError) {
    throw new AppError('Impossibile leggere watchlist utente', 'unknown', 500, {
      cause: watchlistReadError.message,
    })
  }

  let watchlistId = existingWatchlist?.id ?? null

  if (!watchlistId) {
    const { data: insertedWatchlist, error: watchlistInsertError } = await supabase
      .from('watchlists')
      .insert({
        user_id: params.userId,
        name: 'Da guardare',
        is_default: true,
      })
      .select('id')
      .single()

    if (watchlistInsertError || !insertedWatchlist) {
      throw new AppError('Impossibile creare watchlist di default', 'unknown', 500, {
        cause: watchlistInsertError?.message,
      })
    }

    watchlistId = insertedWatchlist.id
  }

  if (params.inWatchlist) {
    const { error: addError } = await supabase
      .from('watchlist_items')
      .upsert(
        {
          watchlist_id: watchlistId,
          video_id: params.videoId,
        },
        { onConflict: 'watchlist_id,video_id' }
      )

    if (addError) {
      throw new AppError('Impossibile aggiungere il video alla watchlist', 'unknown', 500, {
        cause: addError.message,
      })
    }
  } else {
    const { error: removeError } = await supabase
      .from('watchlist_items')
      .delete()
      .eq('watchlist_id', watchlistId)
      .eq('video_id', params.videoId)

    if (removeError) {
      throw new AppError('Impossibile rimuovere il video dalla watchlist', 'unknown', 500, {
        cause: removeError.message,
      })
    }
  }

  return { isInWatchlist: params.inWatchlist }
}

/**
 * Applica limiti di sicurezza per paginazione (anti valori eccessivi o negativi).
 */
function normalizePagination(limit?: number, page?: number) {
  const safeLimit = Math.min(Math.max(limit ?? 20, 1), 50)
  const safePage = Math.max(page ?? 1, 1)
  return { safeLimit, safePage }
}

/**
 * Mappa una riga query `videos + join` in `VideoWithContext` usato dalla UI.
 */
function mapVideoWithContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  preferredLanguage: string,
  userStateMap: Map<string, { seenStatus: 'seen' | 'unseen' | 'hidden'; seenAt: string | null; hiddenAt: string | null }>,
  watchlistVideoIds: Set<string>
): VideoWithContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis = row.video_analysis?.[0] ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const localized = row.video_localized_content?.find((item: any) => item.language_code === preferredLanguage)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ?? row.video_localized_content?.[0]
    ?? null

  const state = userStateMap.get(row.id)
  const seenStatus = state?.seenStatus ?? 'unseen'

  return {
    video: {
      id: row.id,
      channel_id: row.channel_id,
      youtube_video_id: row.youtube_video_id,
      title: row.title,
      description: row.description,
      thumbnail_url: row.thumbnail_url,
      published_at: row.published_at,
      duration_seconds: row.duration_seconds,
      video_url: row.video_url,
      video_type: row.video_type,
      availability_status: row.availability_status,
      youtube_metadata: row.youtube_metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    channel: {
      id: row.channels.id,
      youtube_channel_id: row.channels.youtube_channel_id,
      handle: row.channels.handle,
      title: row.channels.title,
      description: row.channels.description,
      thumbnail_url: row.channels.thumbnail_url,
      subscriber_count: row.channels.subscriber_count,
      video_count: row.channels.video_count,
      custom_url: row.channels.custom_url,
      youtube_metadata: row.channels.youtube_metadata,
      status: row.channels.status,
      created_at: row.channels.created_at,
      updated_at: row.channels.updated_at,
    },
    analysis,
    localizedContent: localized,
    userState: {
      seenStatus,
      isInWatchlist: watchlistVideoIds.has(row.id),
      seenAt: state?.seenAt ?? null,
      hiddenAt: state?.hiddenAt ?? null,
    },
  }
}

/**
 * Restituisce i video visibili all'utente con filtri, paginazione e stato utente.
 * La funzione applica il perimetro canali seguito dall'utente prima di ogni query.
 */
export async function getVideosForUser(params: GetVideosForUserParams): Promise<VideoListResponse> {
  const supabase = await createClient()

  const { data: followedChannels, error: channelsError } = await supabase
    .from('user_channels')
    .select('channel_id')
    .eq('user_id', params.userId)
    .eq('is_active', true)

  if (channelsError) {
    throw new AppError('Impossibile caricare i canali utente', 'unknown', 500, { cause: channelsError.message })
  }

  const allowedChannelIds = new Set((followedChannels ?? []).map((row) => row.channel_id))
  if (allowedChannelIds.size === 0) {
    const { safeLimit, safePage } = normalizePagination(params.limit, params.page)
    return { items: [], total: 0, page: safePage, limit: safeLimit }
  }

  if (params.channelId && !allowedChannelIds.has(params.channelId)) {
    throw new AppError('Canale non disponibile per questo utente', 'forbidden', 403)
  }

  const targetChannelIds = params.channelId ? [params.channelId] : Array.from(allowedChannelIds)
  const { safeLimit, safePage } = normalizePagination(params.limit, params.page)

  let query = supabase
    .from('videos')
    .select(`
      *,
      channels(*),
      video_analysis(id, analysis_status, model_used, analyzed_at, analyzed_by_user_id, error_message, created_at, prompt_profile_id, video_id),
      video_localized_content(*)
    `, { count: 'exact' })
    .in('channel_id', targetChannelIds)
    .eq('availability_status', 'available')
    .eq('video_type', 'standard')

  if (params.search?.trim()) {
    query = query.ilike('title', `%${params.search.trim()}%`)
  }

  const from = (safePage - 1) * safeLimit
  const to = from + safeLimit - 1

  const { data: rows, count, error: videosError } = await query
    .order('published_at', { ascending: false })
    .range(from, to)

  if (videosError) {
    throw new AppError('Impossibile caricare i video', 'unknown', 500, { cause: videosError.message })
  }

  const videoIds = (rows ?? []).map((row) => row.id)

  const { data: states } = videoIds.length
    ? await supabase
      .from('user_video_states')
      .select('video_id, seen_status, seen_at, hidden_at')
      .eq('user_id', params.userId)
      .in('video_id', videoIds)
    : { data: [] as Array<{ video_id: string; seen_status: 'seen' | 'unseen' | 'hidden'; seen_at: string | null; hidden_at: string | null }> }

  const userStateMap = new Map<string, { seenStatus: 'seen' | 'unseen' | 'hidden'; seenAt: string | null; hiddenAt: string | null }>()
  for (const state of states ?? []) {
    userStateMap.set(state.video_id, {
      seenStatus: state.seen_status,
      seenAt: state.seen_at,
      hiddenAt: state.hidden_at,
    })
  }

  const { data: watchlistRows } = videoIds.length
    ? await supabase
      .from('watchlist_items')
      .select('video_id, watchlists!inner(user_id)')
      .in('video_id', videoIds)
      .eq('watchlists.user_id', params.userId)
    : { data: [] as Array<{ video_id: string }> }

  const watchlistVideoIds = new Set((watchlistRows ?? []).map((row) => row.video_id))

  const preferredLanguage = params.languageCode?.trim() || 'it'

  let items = (rows ?? []).map((row) => mapVideoWithContext(row, preferredLanguage, userStateMap, watchlistVideoIds))

  if (params.analysisStatus) {
    items = items.filter((item) => item.analysis?.analysis_status === params.analysisStatus)
  }

  if (params.seenStatus) {
    items = items.filter((item) => item.userState.seenStatus === params.seenStatus)
  }

  if (params.onlyWatchlist) {
    items = items.filter((item) => item.userState.isInWatchlist)
  }

  return {
    items,
    total: count ?? items.length,
    page: safePage,
    limit: safeLimit,
  }
}

interface YouTubePlaylistItem {
  contentDetails?: {
    videoId?: string
    videoPublishedAt?: string
  }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    thumbnails?: {
      maxres?: { url?: string }
      high?: { url?: string }
      medium?: { url?: string }
      default?: { url?: string }
    }
  }
}

interface YouTubeVideoDetailItem {
  id?: string
  contentDetails?: {
    duration?: string
  }
}

/**
 * Seleziona la thumbnail migliore disponibile seguendo priorita` decrescente.
 */
function getBestThumbnail(item: YouTubePlaylistItem): string | null {
  return item.snippet?.thumbnails?.maxres?.url
    ?? item.snippet?.thumbnails?.high?.url
    ?? item.snippet?.thumbnails?.medium?.url
    ?? item.snippet?.thumbnails?.default?.url
    ?? null
}

/**
 * Helper fetch JSON con errore strutturato per risposte non-2xx.
 */
async function fetchJson<T>(url: URL): Promise<T> {
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AppError('Timeout upstream YouTube', 'temporary', 504)
    }
    throw new AppError('Errore connessione upstream YouTube', 'temporary', 502)
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError('Errore autenticazione provider YouTube', 'structural', 422)
    }
    if (response.status === 404) {
      throw new AppError('Risorsa YouTube non trovata', 'not_found', 404)
    }
    throw new AppError('Errore upstream YouTube', 'structural', 422)
  }

  return response.json() as Promise<T>
}

/**
 * Recupera snapshot canale YouTube (playlist uploads + metadati/statistiche utili).
 */
async function getChannelSnapshot(youtubeApiKey: string, youtubeChannelId: string): Promise<{
  uploadsPlaylistId: string
  title: string | null
  description: string | null
  thumbnailUrl: string | null
  subscriberCount: number | null
  videoCount: number | null
  customUrl: string | null
  raw: Json | null
}> {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels')
  url.searchParams.set('part', 'contentDetails,snippet,statistics')
  url.searchParams.set('id', youtubeChannelId)
  url.searchParams.set('key', youtubeApiKey)

  type ChannelsResponse = {
    items?: Array<{
      contentDetails?: { relatedPlaylists?: { uploads?: string } }
      snippet?: {
        title?: string
        description?: string
        customUrl?: string
        thumbnails?: {
          high?: { url?: string }
          medium?: { url?: string }
          default?: { url?: string }
        }
      }
      statistics?: {
        subscriberCount?: string
        videoCount?: string
      }
    }>
  }

  const json = await fetchJson<ChannelsResponse>(url)
  const item = json.items?.[0]
  const uploads = item?.contentDetails?.relatedPlaylists?.uploads

  if (!uploads) {
    throw new AppError('Impossibile trovare playlist uploads del canale', 'not_found', 404)
  }

  const toInt = (value: string | undefined): number | null => {
    if (!value) return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  return {
    uploadsPlaylistId: uploads,
    title: item?.snippet?.title?.trim() ?? null,
    description: item?.snippet?.description ?? null,
    thumbnailUrl:
      item?.snippet?.thumbnails?.high?.url ??
      item?.snippet?.thumbnails?.medium?.url ??
      item?.snippet?.thumbnails?.default?.url ??
      null,
    subscriberCount: toInt(item?.statistics?.subscriberCount),
    videoCount: toInt(item?.statistics?.videoCount),
    customUrl: item?.snippet?.customUrl ? `https://www.youtube.com/${item.snippet.customUrl}` : null,
    raw: (item as unknown as Json) ?? null,
  }
}

/**
 * Elenca gli ultimi elementi della playlist uploads del canale.
 */
async function listRecentPlaylistItems(youtubeApiKey: string, playlistId: string, maxResults: number): Promise<YouTubePlaylistItem[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
  url.searchParams.set('part', 'snippet,contentDetails')
  url.searchParams.set('playlistId', playlistId)
  url.searchParams.set('maxResults', String(Math.min(Math.max(maxResults, 1), 50)))
  url.searchParams.set('key', youtubeApiKey)

  type PlaylistItemsResponse = { items?: YouTubePlaylistItem[] }

  const json = await fetchJson<PlaylistItemsResponse>(url)
  return json.items ?? []
}

/**
 * Recupera la durata dei video tramite endpoint videos.list (chunk max 50 id).
 */
async function listVideoDurations(
  youtubeApiKey: string,
  videoIds: string[]
): Promise<Map<string, number | null>> {
  const normalizedIds = Array.from(new Set(videoIds.filter(Boolean)))
  const durationByVideoId = new Map<string, number | null>()

  for (const videoId of normalizedIds) {
    durationByVideoId.set(videoId, null)
  }

  for (let index = 0; index < normalizedIds.length; index += 50) {
    const chunk = normalizedIds.slice(index, index + 50)
    if (chunk.length === 0) continue

    const url = new URL('https://www.googleapis.com/youtube/v3/videos')
    url.searchParams.set('part', 'contentDetails')
    url.searchParams.set('id', chunk.join(','))
    url.searchParams.set('maxResults', String(chunk.length))
    url.searchParams.set('key', youtubeApiKey)

    type VideosListResponse = {
      items?: YouTubeVideoDetailItem[]
    }

    const json = await fetchJson<VideosListResponse>(url)
    for (const item of json.items ?? []) {
      const videoId = item.id?.trim()
      if (!videoId) continue
      durationByVideoId.set(videoId, parseYouTubeDurationToSeconds(item.contentDetails?.duration))
    }
  }

  return durationByVideoId
}

/**
 * Risolve un handle `@name` nel relativo channel ID canonico `UC...`.
 */
async function resolveChannelIdFromHandle(youtubeApiKey: string, handle: string): Promise<{ channelId: string; title: string | null }> {
  const normalizedHandle = handle.replace(/^@/, '').trim().toLowerCase()
  if (!normalizedHandle) {
    throw new AppError('Handle canale non valido', 'validation', 400)
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/channels')
  url.searchParams.set('part', 'id,snippet')
  url.searchParams.set('forHandle', normalizedHandle)
  url.searchParams.set('key', youtubeApiKey)

  type HandleResolveResponse = {
    items?: Array<{
      id?: string
      snippet?: { title?: string }
    }>
  }

  const json = await fetchJson<HandleResolveResponse>(url)
  const item = json.items?.[0]
  const resolvedId = item?.id

  if (!resolvedId) {
    throw new AppError(`Impossibile risolvere @${normalizedHandle} in channel ID`, 'not_found', 404)
  }

  return {
    channelId: resolvedId,
    title: item?.snippet?.title?.trim() ?? null,
  }
}

/**
 * Importa i video recenti del canale nell'archivio canonico.
 * Se il canale e` in forma `handle:*`, prova prima la risoluzione verso ID `UC...`.
 */
export async function importChannelVideos(params: {
  userId: string
  channelId: string
  maxResults?: number
  bypassUserChannelGuard?: boolean
}): Promise<{ channelId: string; importedCount: number; scannedCount: number }> {
  const supabase = await createClient()
  const admin = createAdminClient()

  const queryClient = params.bypassUserChannelGuard ? admin : supabase
  const { data: userChannel, error: ucError } = await queryClient
    .from('user_channels')
    .select('id')
    .eq('user_id', params.userId)
    .eq('channel_id', params.channelId)
    .eq('is_active', true)
    .maybeSingle()

  if (ucError || !userChannel) {
    throw new AppError('Canale non disponibile per questo utente', 'forbidden', 403, { cause: ucError?.message })
  }

  const { data: channelData, error: channelError } = await queryClient
    .from('channels')
    .select('*')
    .eq('id', params.channelId)
    .single()

  if (channelError || !channelData) {
    throw new AppError('Canale non trovato', 'not_found', 404, { cause: channelError?.message })
  }
  let channel = channelData

  const youtubeApiKey = params.bypassUserChannelGuard
    ? await getProviderApiKeyForUserAsAdmin(params.userId, 'youtube')
    : await getProviderApiKeyForUser(params.userId, 'youtube')
  if (!youtubeApiKey) {
    throw new AppError('Configura prima la chiave YouTube API', 'validation', 400)
  }

  if (channel.youtube_channel_id.startsWith('handle:')) {
    const handle = channel.youtube_channel_id.slice('handle:'.length)
    const resolved = await resolveChannelIdFromHandle(youtubeApiKey, handle)

    const { data: existingCanonical, error: existingCanonicalError } = await admin
      .from('channels')
      .select('*')
      .eq('youtube_channel_id', resolved.channelId)
      .maybeSingle()

    if (existingCanonicalError) {
      throw new AppError('Risoluzione handle completata ma lookup canale canonico fallito', 'unknown', 500, {
        cause: existingCanonicalError.message,
      })
    }

    if (existingCanonical && existingCanonical.id !== channel.id) {
      // Merge automatico: collega l'utente al canale canonico gia esistente.
      const { error: relinkError } = await admin
        .from('user_channels')
        .upsert(
          {
            user_id: params.userId,
            channel_id: existingCanonical.id,
            is_active: true,
            removed_at: null,
          },
          { onConflict: 'user_id,channel_id' }
        )

      if (relinkError) {
        throw new AppError('Risoluzione handle completata ma merge user_channel fallito', 'unknown', 500, {
          cause: relinkError.message,
        })
      }

      await admin
        .from('user_channels')
        .update({
          is_active: false,
          removed_at: new Date().toISOString(),
        })
        .eq('user_id', params.userId)
        .eq('channel_id', channel.id)

      await admin
        .from('canonical_sync_state')
        .upsert({ channel_id: existingCanonical.id }, { onConflict: 'channel_id' })

      const { count: activeReferences } = await admin
        .from('user_channels')
        .select('*', { head: true, count: 'exact' })
        .eq('channel_id', channel.id)
        .eq('is_active', true)

      if ((activeReferences ?? 0) === 0) {
        await admin
          .from('channels')
          .update({ status: 'inactive' })
          .eq('id', channel.id)
      }

      channel = existingCanonical
    } else {
      // Aggiorna il canale globale alla forma canonica `UC...` appena disponibile.
      const { error: channelUpdateError } = await admin
        .from('channels')
        .update({
          youtube_channel_id: resolved.channelId,
          title: resolved.title ?? channel.title,
          handle: handle,
        })
        .eq('id', channel.id)

      if (channelUpdateError) {
        throw new AppError('Risoluzione handle completata ma update canale fallito', 'unknown', 500, {
          cause: channelUpdateError.message,
        })
      }

      channel.youtube_channel_id = resolved.channelId
    }
  }

  const maxResults = params.maxResults ?? 20
  const channelSnapshot = await getChannelSnapshot(youtubeApiKey, channel.youtube_channel_id)
  const uploadsPlaylistId = channelSnapshot.uploadsPlaylistId

  await admin
    .from('channels')
    .update({
      title: channelSnapshot.title ?? channel.title,
      description: channelSnapshot.description ?? channel.description,
      thumbnail_url: channelSnapshot.thumbnailUrl ?? channel.thumbnail_url,
      subscriber_count: channelSnapshot.subscriberCount,
      video_count: channelSnapshot.videoCount,
      custom_url: channelSnapshot.customUrl ?? channel.custom_url,
      youtube_metadata: channelSnapshot.raw,
    })
    .eq('id', channel.id)

  const items = await listRecentPlaylistItems(youtubeApiKey, uploadsPlaylistId, maxResults)
  const videoIds = items
    .map((item) => item.contentDetails?.videoId)
    .filter((videoId): videoId is string => Boolean(videoId))

  let durationsByVideoId = new Map<string, number | null>()
  try {
    durationsByVideoId = await listVideoDurations(youtubeApiKey, videoIds)
  } catch {
    // Fail-open: se il fetch delle durate fallisce manteniamo sync attiva con duration null.
    durationsByVideoId = new Map<string, number | null>()
  }

  const upsertRows = items
    .map((item) => {
      const videoId = item.contentDetails?.videoId
      if (!videoId) return null

      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt
      if (!publishedAt) return null

      const title = item.snippet?.title?.trim() || `Video ${videoId}`
      const description = item.snippet?.description ?? null
      const thumbnail = getBestThumbnail(item)

      return {
        channel_id: params.channelId,
        youtube_video_id: videoId,
        title,
        description,
        thumbnail_url: thumbnail,
        published_at: publishedAt,
        duration_seconds: durationsByVideoId.get(videoId) ?? null,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        video_type: 'standard' as const,
        availability_status: 'available' as const,
        youtube_metadata: item as unknown as Json,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  if (upsertRows.length === 0) {
    await queryClient
      .from('canonical_sync_state')
      .upsert({
        channel_id: params.channelId,
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'partial',
        videos_found_count: 0,
      }, { onConflict: 'channel_id' })

    return {
      channelId: params.channelId,
      importedCount: 0,
      scannedCount: items.length,
    }
  }

  // Deduplica locale per evitare errore Postgres quando lo stesso youtube_video_id
  // compare piu volte nello stesso batch di upsert.
  const dedupedRows = Array.from(
    new Map(upsertRows.map((row) => [row.youtube_video_id, row])).values()
  )

  const { data: insertedRows, error: insertError } = await queryClient
    .from('videos')
    .upsert(dedupedRows, { onConflict: 'youtube_video_id' })
    .select('id')

  if (insertError) {
    throw new AppError('Import video fallito', 'unknown', 500, { cause: insertError.message })
  }

  await queryClient
    .from('canonical_sync_state')
    .upsert({
      channel_id: params.channelId,
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      videos_found_count: dedupedRows.length,
    }, { onConflict: 'channel_id' })

  await queryClient
    .from('user_provider_credentials')
    .update({
      is_valid: true,
      last_used_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('user_id', params.userId)
    .eq('provider', 'youtube')

    return {
      channelId: params.channelId,
      importedCount: insertedRows?.length ?? dedupedRows.length,
      scannedCount: items.length,
    }
}
