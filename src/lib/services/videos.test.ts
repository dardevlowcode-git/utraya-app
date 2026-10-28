import { describe, expect, it } from 'vitest'
import { createFilteringSupabase } from '@/__tests__/helpers/filteringSupabase'
import { getVideosForUser } from '@/lib/services/videos'

function createVideo(id: string, channelId: string, publishedAt: string, analysisStatus: string) {
  const channel = {
    id: channelId,
    youtube_channel_id: `youtube-${channelId}`,
    handle: null,
    title: `Canale ${channelId}`,
    description: null,
    thumbnail_url: null,
    subscriber_count: null,
    video_count: null,
    custom_url: null,
    youtube_metadata: null,
    status: 'active',
    created_at: publishedAt,
    updated_at: publishedAt,
  }

  return {
    id,
    channel_id: channelId,
    youtube_video_id: `youtube-${id}`,
    title: `Titolo ${id}`,
    description: null,
    thumbnail_url: null,
    published_at: publishedAt,
    duration_seconds: null,
    video_url: `https://www.youtube.com/watch?v=${id}`,
    video_type: 'standard',
    availability_status: 'available',
    youtube_metadata: null,
    created_at: publishedAt,
    updated_at: publishedAt,
    channels: channel,
    video_analysis: [{
      id: `analysis-${id}`,
      analysis_status: analysisStatus,
      model_used: null,
      analyzed_at: null,
      analyzed_by_user_id: null,
      error_message: null,
      created_at: publishedAt,
      prompt_profile_id: null,
      video_id: id,
    }],
    video_localized_content: [],
  }
}

function createTwoUserSupabase() {
  return createFilteringSupabase({
    user_channels: [
      { id: 'relation-a', user_id: 'user-a', channel_id: 'channel-shared', is_active: true },
      { id: 'relation-b-shared', user_id: 'user-b', channel_id: 'channel-shared', is_active: true },
      { id: 'relation-b-private', user_id: 'user-b', channel_id: 'channel-b', is_active: true },
    ],
    videos: [
      createVideo('v1', 'channel-shared', '2026-06-06T00:00:00.000Z', 'completed'),
      createVideo('v2', 'channel-shared', '2026-06-04T00:00:00.000Z', 'completed'),
      createVideo('v3', 'channel-shared', '2026-06-03T00:00:00.000Z', 'pending'),
      createVideo('v4', 'channel-shared', '2026-06-02T00:00:00.000Z', 'completed'),
      createVideo('v5', 'channel-shared', '2026-06-05T00:00:00.000Z', 'completed'),
      createVideo('v6', 'channel-shared', '2026-06-01T00:00:00.000Z', 'completed'),
      createVideo('video-b-only', 'channel-b', '2026-06-07T00:00:00.000Z', 'completed'),
    ],
    user_video_states: [
      { user_id: 'user-a', video_id: 'v1', seen_status: 'seen', seen_at: '2026-06-01T00:00:00.000Z', hidden_at: null },
      { user_id: 'user-a', video_id: 'v4', seen_status: 'hidden', seen_at: null, hidden_at: '2026-06-01T00:00:00.000Z' },
      { user_id: 'user-b', video_id: 'v2', seen_status: 'seen', seen_at: '2026-06-02T00:00:00.000Z', hidden_at: null },
      { user_id: 'user-b', video_id: 'v6', seen_status: 'seen', seen_at: '2026-06-03T00:00:00.000Z', hidden_at: null },
      { user_id: 'user-b', video_id: 'video-b-only', seen_status: 'seen', seen_at: '2026-06-04T00:00:00.000Z', hidden_at: null },
    ],
    watchlists: [
      { id: 'watchlist-a', user_id: 'user-a', is_default: true, name: 'Da guardare' },
      { id: 'watchlist-b', user_id: 'user-b', is_default: true, name: 'Da guardare' },
    ],
    watchlist_items: [
      { id: 'a-v1', watchlist_id: 'watchlist-a', video_id: 'v1' },
      { id: 'a-v2', watchlist_id: 'watchlist-a', video_id: 'v2' },
      { id: 'a-v3', watchlist_id: 'watchlist-a', video_id: 'v3' },
      { id: 'a-v5', watchlist_id: 'watchlist-a', video_id: 'v5' },
      { id: 'b-v2', watchlist_id: 'watchlist-b', video_id: 'v2' },
      { id: 'b-v4', watchlist_id: 'watchlist-b', video_id: 'v4' },
      { id: 'b-v6', watchlist_id: 'watchlist-b', video_id: 'v6' },
      { id: 'b-private', watchlist_id: 'watchlist-b', video_id: 'video-b-only' },
    ],
  })
}

describe('getVideosForUser', () => {
  it('isola canali, stati e watchlist e filtra prima di paginare', async () => {
    const fake = createTwoUserSupabase()

    const result = await getVideosForUser({
      userId: 'user-a',
      onlyWatchlist: true,
      seenStatus: 'unseen',
      analysisStatus: 'completed',
      limit: 1,
      page: 2,
      supabase: fake.client,
    })

    expect(result).toMatchObject({ page: 2, limit: 1, total: 2 })
    expect(result.items.map((item) => item.video.id)).toEqual(['v2'])
    expect(result.items[0].userState).toMatchObject({ seenStatus: 'unseen', isInWatchlist: true })

    const unfiltered = await getVideosForUser({ userId: 'user-a', supabase: fake.client })
    expect(unfiltered.items.map((item) => item.video.id)).not.toContain('video-b-only')
    expect(unfiltered.items.every((item) => item.video.channel_id === 'channel-shared')).toBe(true)
    expect(unfiltered.items.find((item) => item.video.id === 'v2')?.userState).toMatchObject({
      seenStatus: 'unseen',
      isInWatchlist: true,
    })
    expect(unfiltered.items.find((item) => item.video.id === 'v6')?.userState).toMatchObject({
      seenStatus: 'unseen',
      isInWatchlist: false,
    })
  })

  it('rifiuta un channelId non seguito dall’utente', async () => {
    const fake = createTwoUserSupabase()

    await expect(getVideosForUser({
      userId: 'user-a',
      channelId: 'channel-b',
      supabase: fake.client,
    })).rejects.toMatchObject({ statusCode: 403 })
  })
})
