/* Commento didattico:
 * Scopo del file: verifica che il worker admin non dipenda dal contesto HTTP dell'utente.
 * Moduli richiamati: `importChannelVideos`, client Supabase mockati e Vitest.
 * Flusso: simula ownership/admin e credenziale provider assente senza creare un client cookie.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createClientMock, createAdminClientMock, getProviderApiKeyForUserAsAdminMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  getProviderApiKeyForUserAsAdminMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@/lib/services/integrations', () => ({
  getProviderApiKeyForUser: vi.fn(),
  getProviderApiKeyForUserAsAdmin: getProviderApiKeyForUserAsAdminMock,
}))

import { importChannelVideos } from '@/lib/services/videos'

function query(value: unknown) {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (result: unknown) => void, reject?: (error: unknown) => void) =>
          Promise.resolve(value).then(resolve, reject)
      }
      if (property === 'single' || property === 'maybeSingle') {
        return () => Promise.resolve(value)
      }
      return (..._args: unknown[]) => query(value)
    },
  })
}

describe('importChannelVideos worker context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockRejectedValue(new Error('request cookie context unavailable'))
    getProviderApiKeyForUserAsAdminMock.mockResolvedValue(null)
    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => query({
        data: table === 'user_channels' ? { id: 'relation-1' } : {
          id: 'channel-1',
          youtube_channel_id: 'UCsynthetic',
          handle: null,
          title: 'DEV worker fixture',
          description: null,
          thumbnail_url: null,
          subscriber_count: null,
          video_count: null,
          custom_url: null,
          youtube_metadata: null,
          status: 'active',
          created_at: '2026-10-03T00:00:00.000Z',
          updated_at: '2026-10-03T00:00:00.000Z',
        },
        error: null,
      })),
    })
  })

  it('uses only the admin client when the worker bypasses the user-channel guard', async () => {
    await expect(importChannelVideos({
      userId: 'user-1',
      channelId: 'channel-1',
      bypassUserChannelGuard: true,
      lease: { jobId: 'job-1', leaseId: 'lease-1' },
    })).rejects.toThrow('Configura prima la chiave YouTube API')

    expect(createClientMock).not.toHaveBeenCalled()
    expect(getProviderApiKeyForUserAsAdminMock).toHaveBeenCalledWith('user-1', 'youtube')
  })
})
