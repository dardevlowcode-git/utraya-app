/* Commento didattico:
 * Scopo del file: verifica che lettura, aggiunta e rimozione della watchlist restino nel perimetro dell’utente.
 * Moduli richiamati: servizi `watchlist` e `videos`, fake Supabase con filtri applicati e `vitest`.
 * Flusso: A e B condividono video e watchlist nel fake; le operazioni di A non devono esporre né alterare quelle di B.
 */

import { describe, expect, it } from 'vitest'
import { createFilteringSupabase } from '@/__tests__/helpers/filteringSupabase'
import { setVideoWatchlistForUser } from '@/lib/services/videos'
import { getWatchlistForUser, removeVideoFromWatchlist } from '@/lib/services/watchlist'

function createTwoUserSupabase() {
  return createFilteringSupabase({
    user_channels: [
      { id: 'relation-a', user_id: 'user-a', channel_id: 'channel-shared', is_active: true },
      { id: 'relation-b', user_id: 'user-b', channel_id: 'channel-shared', is_active: true },
      { id: 'relation-b-only', user_id: 'user-b', channel_id: 'channel-b', is_active: true },
    ],
    videos: [
      { id: 'video-shared', channel_id: 'channel-shared' },
      { id: 'video-to-add', channel_id: 'channel-shared' },
      { id: 'video-b-only', channel_id: 'channel-b' },
    ],
    watchlists: [
      { id: 'watchlist-a', user_id: 'user-a', is_default: true, name: 'Lista A' },
      { id: 'watchlist-b', user_id: 'user-b', is_default: true, name: 'Lista B' },
    ],
    watchlist_items: [
      {
        id: 'item-a',
        watchlist_id: 'watchlist-a',
        video_id: 'video-shared',
        added_at: '2026-10-20T10:00:00.000Z',
        videos: {
          id: 'video-shared',
          title: 'Video condiviso',
          thumbnail_url: null,
          published_at: null,
          duration_seconds: null,
          channels: { id: 'channel-shared', title: 'Canale condiviso', handle: null },
        },
      },
      {
        id: 'item-b',
        watchlist_id: 'watchlist-b',
        video_id: 'video-shared',
        added_at: '2026-10-20T11:00:00.000Z',
        videos: {
          id: 'video-shared',
          title: 'Video condiviso',
          thumbnail_url: null,
          published_at: null,
          duration_seconds: null,
          channels: { id: 'channel-shared', title: 'Canale condiviso', handle: null },
        },
      },
      { id: 'item-b-to-add', watchlist_id: 'watchlist-b', video_id: 'video-to-add' },
    ],
  })
}

describe('servizi watchlist', () => {
  it('A legge, aggiunge e rimuove solo righe della propria watchlist', async () => {
    const fake = createTwoUserSupabase()

    const watchlist = await getWatchlistForUser('user-a', fake.client)
    expect(watchlist.id).toBe('watchlist-a')
    expect(watchlist.items.map((item) => item.id)).toEqual(['item-a'])

    await setVideoWatchlistForUser({
      userId: 'user-a',
      videoId: 'video-to-add',
      inWatchlist: true,
      supabase: fake.client,
    })
    const afterAdd = fake.rows('watchlist_items')
    expect(afterAdd).toContainEqual(expect.objectContaining({ watchlist_id: 'watchlist-a', video_id: 'video-to-add' }))
    expect(afterAdd).toContainEqual(expect.objectContaining({ id: 'item-b-to-add', watchlist_id: 'watchlist-b', video_id: 'video-to-add' }))

    await removeVideoFromWatchlist({ userId: 'user-a', videoId: 'video-to-add', supabase: fake.client })
    expect(fake.rows('watchlist_items')).toEqual([
      expect.objectContaining({ id: 'item-a', watchlist_id: 'watchlist-a', video_id: 'video-shared' }),
      expect.objectContaining({ id: 'item-b', watchlist_id: 'watchlist-b', video_id: 'video-shared' }),
      expect.objectContaining({ id: 'item-b-to-add', watchlist_id: 'watchlist-b', video_id: 'video-to-add' }),
    ])
  })

  it('rifiuta di aggiungere video appartenenti a un canale non seguito', async () => {
    const fake = createTwoUserSupabase()

    await expect(setVideoWatchlistForUser({
      userId: 'user-a',
      videoId: 'video-b-only',
      inWatchlist: true,
      supabase: fake.client,
    })).rejects.toMatchObject({ statusCode: 403 })

    expect(fake.rows('watchlist_items')).toHaveLength(3)
  })
})
