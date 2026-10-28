import { describe, expect, it } from 'vitest'
import { toChannelApiView } from './channelApi'
import { toIntegrationApiView } from './integrationApi'
import { toVideoApiView, toVideoListApiView } from './videoApi'
import { toWatchlistItemView } from './watchlistApi'
import type { UserChannelListItem } from '@/lib/services/channels'
import type { CredentialStatus, VideoWithContext } from '@/lib/types/domain'

function channelItem(): UserChannelListItem {
  return {
    userChannel: { added_at: '2026-09-01T10:00:00.000Z' },
    channel: {
      id: 'channel-1',
      youtube_channel_id: 'UCtest',
      handle: '@test',
      title: 'Canale Test',
      description: 'Descrizione',
      thumbnail_url: 'https://img.test/t.jpg',
      custom_url: 'https://www.youtube.com/@test',
    },
    preferences: { sync_frequency_hours: 24, is_paused: false },
    syncState: { last_sync_at: '2026-09-02T10:00:00.000Z', last_sync_status: 'completed', videos_found_count: 7 },
  } as unknown as UserChannelListItem
}

function videoItem(): VideoWithContext {
  return {
    video: {
      id: 'video-1',
      channel_id: 'channel-1',
      youtube_video_id: 'yt1',
      title: 'Video Test',
      description: 'Desc',
      thumbnail_url: null,
      published_at: null,
      duration_seconds: 120,
      video_url: 'https://www.youtube.com/watch?v=yt1',
      video_type: 'video',
      availability_status: 'available',
      created_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-01T10:00:00.000Z',
    },
    channel: {
      id: 'channel-1',
      youtube_channel_id: 'UCtest',
      handle: '@test',
      title: 'Canale Test',
      description: null,
      thumbnail_url: null,
      custom_url: null,
      status: 'active',
    },
    analysis: { id: 'a1', analysis_status: 'completed', model_used: 'gemini-test', analyzed_at: '2026-09-02T10:00:00.000Z' },
    localizedContent: null,
    userState: { seenStatus: 'unseen', isInWatchlist: false, seenAt: null, hiddenAt: null },
  } as unknown as VideoWithContext
}

describe('API v1 view models', () => {
  it('mappa il canale senza row Supabase grezze', () => {
    const view = toChannelApiView(channelItem())
    expect(view).toEqual({
      id: 'channel-1',
      youtubeChannelId: 'UCtest',
      handle: '@test',
      title: 'Canale Test',
      description: 'Descrizione',
      thumbnailUrl: 'https://img.test/t.jpg',
      customUrl: 'https://www.youtube.com/@test',
      addedAt: '2026-09-01T10:00:00.000Z',
      preferences: { syncFrequencyHours: 24, paused: false },
      sync: {
        lastSyncAt: '2026-09-02T10:00:00.000Z',
        status: 'completed',
        videosFound: 7,
      },
    })
    expect('user_id' in view).toBe(false)
  })

  it('mappa il video con contesto utente e lista paginata', () => {
    const view = toVideoApiView(videoItem())
    const expectedVideo = {
      id: 'video-1',
      channelId: 'channel-1',
      youtubeVideoId: 'yt1',
      title: 'Video Test',
      description: 'Desc',
      thumbnailUrl: null,
      publishedAt: null,
      durationSeconds: 120,
      videoUrl: 'https://www.youtube.com/watch?v=yt1',
      type: 'video',
      availabilityStatus: 'available',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      channel: {
        id: 'channel-1',
        youtubeChannelId: 'UCtest',
        handle: '@test',
        title: 'Canale Test',
        description: null,
        thumbnailUrl: null,
        customUrl: null,
        status: 'active',
      },
      analysis: {
        id: 'a1',
        status: 'completed',
        model: 'gemini-test',
        analyzedAt: '2026-09-02T10:00:00.000Z',
      },
      localizedContent: null,
      userState: { seenStatus: 'unseen', isInWatchlist: false, seenAt: null, hiddenAt: null },
    }
    expect(view).toEqual(expectedVideo)

    const list = toVideoListApiView({ items: [videoItem()], page: 2, limit: 1, total: 5 })
    expect(list).toEqual({ items: [expectedVideo], page: 2, limit: 1, total: 5 })
  })

  it('nasconde la chiave e riduce gli errori provider a booleano', () => {
    const status: CredentialStatus = {
      provider: 'youtube',
      isConfigured: true,
      isValid: false,
      validationStatus: 'completed',
      lastValidatedAt: '2026-09-02T10:00:00.000Z',
      lastUsedAt: null,
      lastError: 'quota_exceeded_dettaglio_interno',
      maskedKey: 'AIza...abcd',
    }
    const view = toIntegrationApiView(status)
    expect(view).toEqual({
      provider: 'youtube',
      isConfigured: true,
      isValid: false,
      validationStatus: 'completed',
      lastValidatedAt: '2026-09-02T10:00:00.000Z',
      lastUsedAt: null,
      hasValidationError: true,
      maskedKey: 'AIza...abcd',
    })
    expect(JSON.stringify(view)).not.toContain('quota_exceeded_dettaglio_interno')
  })

  it('normalizza la relazione video/canale della watchlist', () => {
    const view = toWatchlistItemView({
      id: 'item-1',
      video_id: 'video-1',
      added_at: '2026-09-03T10:00:00.000Z',
      videos: {
        id: 'video-1',
        title: 'Video Test',
        thumbnail_url: null,
        published_at: null,
        duration_seconds: 60,
        channels: { id: 'channel-1', title: 'Canale Test', handle: '@test' },
      },
    })
    expect(view).toEqual({
      id: 'item-1',
      videoId: 'video-1',
      addedAt: '2026-09-03T10:00:00.000Z',
      video: {
        id: 'video-1',
        title: 'Video Test',
        thumbnailUrl: null,
        publishedAt: null,
        durationSeconds: 60,
        channel: { id: 'channel-1', title: 'Canale Test', handle: '@test' },
      },
    })
  })

  it('restituisce video nullo quando la relazione manca', () => {
    const view = toWatchlistItemView({ id: 'item-2', video_id: 'video-2', added_at: '2026-09-03T10:00:00.000Z' })
    expect(view).toEqual({
      id: 'item-2',
      videoId: 'video-2',
      addedAt: '2026-09-03T10:00:00.000Z',
      video: null,
    })
  })
})
