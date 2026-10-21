/* Commento didattico:
 * Scopo del file: verifica l'eleggibilità della chiave del richiedente nel confine Supabase del worker.
 * Moduli richiamati: `vitest` e store di trascrizione.
 * Flusso: simula il video e l'RPC canonica d'eleggibilità; nessuna query o chiave reale.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, rpc, getApiKey, filters, videoChannel } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getApiKey: vi.fn(),
  filters: [] as Array<[string, unknown]>,
  videoChannel: { current: null as string | null },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from, rpc }) }))
vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: getApiKey }))

import { createSupabaseTranscriptionStore } from '@/lib/services/transcription-store'

describe('idoneità della chiave del richiedente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filters.length = 0
    videoChannel.current = 'channel-legacy'
    from.mockImplementation((table: string) => {
      if (table !== 'videos') throw new Error(`tabella inattesa: ${table}`)
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push([column, value])
          return query
        }),
        maybeSingle: vi.fn(async () => ({ data: videoChannel.current ? { channel_id: videoChannel.current } : null, error: null })),
      }
      return query
    })
    rpc.mockResolvedValue({ data: [{ user_id: 'another-follower', retry_limit: 2 }], error: null })
    getApiKey.mockResolvedValue('synthetic-gemini-key')
  })

  it('non usa la chiave di un richiedente non più follower nei vecchi job senza channelId', async () => {
    const store = createSupabaseTranscriptionStore({ from, rpc } as never)

    const result = await store.loadCredential({
      ownerUserId: 'requester',
      channelId: null,
      videoId: 'video-legacy',
    })

    expect(filters).toEqual([['id', 'video-legacy']])
    expect(rpc).toHaveBeenCalledWith('transcription_eligible_credentials', { p_channel_id: 'channel-legacy' })
    expect(result).toEqual({ credential: null, channelId: 'channel-legacy' })
    expect(getApiKey).not.toHaveBeenCalled()
  })

  it("restituisce la chiave del richiedente solo se presente nell'elenco canonico", async () => {
    rpc.mockResolvedValue({
      data: [{ user_id: 'requester', credential_id: 'credential-1', key_version: 'version-1', retry_limit: 2 }],
      error: null,
    })
    const store = createSupabaseTranscriptionStore({ from, rpc } as never)

    const result = await store.loadCredential({
      ownerUserId: 'requester',
      channelId: 'channel-active',
      videoId: 'video-1',
    })

    expect(result).toEqual({
      channelId: 'channel-active',
      credential: { ownerUserId: 'requester', apiKey: 'synthetic-gemini-key', retryLimit: 2 },
    })
    expect(getApiKey).toHaveBeenCalledWith('requester', 'gemini')
  })

  it('non usa la chiave privata se il video non consente di risolvere il canale', async () => {
    videoChannel.current = null
    const store = createSupabaseTranscriptionStore({ from, rpc } as never)

    const result = await store.loadCredential({ ownerUserId: 'requester', channelId: null, videoId: 'missing-video' })

    expect(result).toEqual({ credential: null, channelId: null })
    expect(rpc).not.toHaveBeenCalled()
    expect(getApiKey).not.toHaveBeenCalled()
  })
})
