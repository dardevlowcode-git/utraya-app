/* Commento didattico:
 * Scopo del file: mappa le row watchlist nel view model API senza far uscire relazioni Supabase grezze.
 * Moduli richiamati: nessuno.
 * Flusso: normalizza relazioni singolo/array e serializza solo video/canale pubblici.
 */

export type WatchlistItemView = {
  id: string
  videoId: string
  addedAt: string
  video: {
    id: string
    title: string
    thumbnailUrl: string | null
    publishedAt: string | null
    durationSeconds: number | null
    channel: { id: string; title: string; handle: string | null } | null
  } | null
}

export type WatchlistView = {
  id: string | null
  name: string | null
  items: WatchlistItemView[]
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export function toWatchlistItemView(row: {
  id: string
  video_id: string
  added_at: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos?: any
}): WatchlistItemView {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawVideo = first(row.videos as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawChannel = first(rawVideo?.channels as any)
  return {
    id: row.id,
    videoId: row.video_id,
    addedAt: row.added_at,
    video: rawVideo
      ? {
          id: rawVideo.id,
          title: rawVideo.title,
          thumbnailUrl: rawVideo.thumbnail_url,
          publishedAt: rawVideo.published_at,
          durationSeconds: rawVideo.duration_seconds,
          channel: rawChannel ? { id: rawChannel.id, title: rawChannel.title, handle: rawChannel.handle } : null,
        }
      : null,
  }
}
