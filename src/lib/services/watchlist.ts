/* Commento didattico:
 * Scopo del file: espone la watchlist utente come view model API senza restituire row Supabase grezze.
 * Moduli richiamati: `@/lib/supabase/server`, `@/lib/utils/errors`, `@/lib/supabase/types`.
 * Flusso: verifica il perimetro utente tramite RLS, legge la watchlist default e mappa video/canale in JSON stabile.
 */

import { createClient } from '@/lib/supabase/server'
import type { AppSupabaseClient } from '@/lib/supabase/types'
import { AppError } from '@/lib/utils/errors'
import { toWatchlistItemView, type WatchlistView } from '@/lib/view-models/watchlistApi'

export async function getWatchlistForUser(userId: string, client?: AppSupabaseClient): Promise<WatchlistView> {
  const supabase = client ?? await createClient()
  const { data: watchlist, error: watchlistError } = await supabase
    .from('watchlists')
    .select('id, name')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()

  if (watchlistError) {
    throw new AppError('Impossibile leggere la watchlist', 'unknown', 500, { cause: watchlistError.message })
  }

  if (!watchlist) return { id: null, name: null, items: [] }

  const { data: rows, error: itemsError } = await supabase
    .from('watchlist_items')
    .select(`
      id, video_id, added_at,
      videos(id, title, thumbnail_url, published_at, duration_seconds, channels(id, title, handle))
    `)
    .eq('watchlist_id', watchlist.id)
    .order('added_at', { ascending: false })

  if (itemsError) {
    throw new AppError('Impossibile leggere gli elementi della watchlist', 'unknown', 500, { cause: itemsError.message })
  }

  const items = (rows ?? []).map((row) => toWatchlistItemView(row))

  return { id: watchlist.id, name: watchlist.name, items }
}

export async function removeVideoFromWatchlist(params: {
  userId: string
  videoId: string
  supabase?: AppSupabaseClient
}): Promise<{ removed: boolean }> {
  const supabase = params.supabase ?? await createClient()
  const { data: watchlist, error: watchlistError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', params.userId)
    .eq('is_default', true)
    .maybeSingle()

  if (watchlistError) {
    throw new AppError('Impossibile leggere la watchlist', 'unknown', 500, { cause: watchlistError.message })
  }
  if (!watchlist) return { removed: false }

  const { error } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('watchlist_id', watchlist.id)
    .eq('video_id', params.videoId)

  if (error) {
    throw new AppError('Impossibile rimuovere il video dalla watchlist', 'unknown', 500, { cause: error.message })
  }

  return { removed: true }
}
