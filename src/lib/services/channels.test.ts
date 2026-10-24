/* Commento didattico:
 * Scopo del file: verifica detector di business e isolamento della rimozione canale fra utenti.
 * Moduli richiamati: `channels`, fake Supabase con filtri applicati, `AppError` e `vitest`.
 * Flusso: prova classificazione errori e rimozione della sola relazione e dei dati privati di A.
 */

import { describe, expect, it } from 'vitest'
import { createFilteringSupabase } from '@/__tests__/helpers/filteringSupabase'
import { AppError } from '@/lib/utils/errors'
import { detectScanBlockedReasonFromError, removeChannelForUser } from '@/lib/services/channels'

describe('detectScanBlockedReasonFromError', () => {
  it('riconosce mancanza API key YouTube', () => {
    const reason = detectScanBlockedReasonFromError(
      new AppError('Configura prima la chiave YouTube API', 'validation', 400)
    )

    expect(reason).toBe('missing_youtube_api_key')
  })

  it('ignora errori non correlati', () => {
    const reason = detectScanBlockedReasonFromError(
      new AppError('Errore upstream YouTube', 'structural', 422)
    )

    expect(reason).toBeNull()
  })
})

describe('removeChannelForUser', () => {
  it('rimuove la relazione di A senza toccare quella di B', async () => {
    const fake = createFilteringSupabase({
      user_channels: [
        { id: 'relation-a', user_id: 'user-a', channel_id: 'channel-shared', is_active: true },
        { id: 'relation-b', user_id: 'user-b', channel_id: 'channel-shared', is_active: true },
      ],
      videos: [{ id: 'video-shared', channel_id: 'channel-shared' }],
      user_video_states: [
        { user_id: 'user-a', video_id: 'video-shared', seen_status: 'seen' },
        { user_id: 'user-b', video_id: 'video-shared', seen_status: 'hidden' },
      ],
      watchlists: [
        { id: 'watchlist-a', user_id: 'user-a', is_default: true },
        { id: 'watchlist-b', user_id: 'user-b', is_default: true },
      ],
      watchlist_items: [
        { id: 'item-a', watchlist_id: 'watchlist-a', video_id: 'video-shared' },
        { id: 'item-b', watchlist_id: 'watchlist-b', video_id: 'video-shared' },
      ],
      user_channel_preferences: [
        { id: 'preference-a', user_channel_id: 'relation-a' },
        { id: 'preference-b', user_channel_id: 'relation-b' },
      ],
    })

    await removeChannelForUser({ userId: 'user-a', channelId: 'channel-shared', supabase: fake.client })

    expect(fake.rows('user_channels')).toEqual([
      expect.objectContaining({ id: 'relation-b', user_id: 'user-b', channel_id: 'channel-shared' }),
    ])
    expect(fake.rows('user_video_states')).toEqual([
      expect.objectContaining({ user_id: 'user-b', video_id: 'video-shared', seen_status: 'hidden' }),
    ])
    expect(fake.rows('watchlist_items')).toEqual([
      expect.objectContaining({ id: 'item-b', watchlist_id: 'watchlist-b', video_id: 'video-shared' }),
    ])
    expect(fake.rows('user_channel_preferences')).toEqual([
      expect.objectContaining({ id: 'preference-b', user_channel_id: 'relation-b' }),
    ])
  })
})
