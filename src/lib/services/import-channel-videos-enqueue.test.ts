/* Commento didattico:
 * Scopo del file: verifica l'accodamento automatico delle trascrizioni nel percorso di import senza lease (import manuale).
 * Moduli richiamati: `importChannelVideos`, client Supabase e registratore uso mockati, Vitest.
 * Flusso: solo i video non presenti prima dell'upsert vengono passati alla RPC idempotente; un errore della RPC non rompe l'import.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  fetchProvider: vi.fn(),
  rpc: vi.fn(),
  existingYoutubeIds: [] as string[],
  lastSyncAt: '2026-10-01T00:00:00Z' as string | null,
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/services/integrations', () => ({
  getProviderApiKeyForUser: vi.fn(),
  getProviderApiKeyForUserAsAdmin: vi.fn(async () => 'synthetic-youtube-key'),
}))
vi.mock('@/lib/services/api-usage', () => ({ fetchAndRecordProviderRequest: mocks.fetchProvider }))

import { importChannelVideos } from '@/lib/services/videos'

const CHANNEL_ROW = {
  id: 'channel-1', youtube_channel_id: 'UCsynthetic', handle: null, title: 'Canale sintetico', description: null,
  thumbnail_url: null, subscriber_count: null, video_count: null, custom_url: null, youtube_metadata: null, status: 'active',
}

/** Builder minimale: risolve in base alla tabella e alle operazioni concatenate (select/in/upsert). */
function from(table: string) {
  const ops: string[] = []
  const resolve = () => {
    if (table === 'canonical_sync_state' && !ops.includes('upsert')) return { data: mocks.lastSyncAt ? { last_sync_at: mocks.lastSyncAt } : null, error: null }
    if (table === 'user_channels') return { data: { id: 'relation-1' }, error: null }
    if (table === 'channels') return { data: CHANNEL_ROW, error: null }
    if (table === 'videos' && ops.includes('upsert')) return { data: [], error: null }
    if (table === 'videos') return { data: mocks.existingYoutubeIds.map((id) => ({ youtube_video_id: id })), error: null }
    return { data: null, error: null }
  }
  const proxy: object = new Proxy({}, {
    get(_target, property: string) {
      if (property === 'then') {
        return (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onFulfilled, onRejected)
      }
      if (property === 'single' || property === 'maybeSingle') return () => Promise.resolve(resolve())
      return (..._args: unknown[]) => { ops.push(property); return proxy }
    },
  })
  return proxy
}

function youtubeResponse(url: string): Response {
  if (url.includes('/channels')) {
    return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUsynthetic' } }, snippet: { title: 'Canale sintetico' } }] })
  }
  if (url.includes('/playlistItems')) {
    const item = (id: string) => ({
      snippet: { title: `Video ${id}`, publishedAt: '2026-10-01T00:00:00Z' },
      contentDetails: { videoId: id, videoPublishedAt: '2026-10-01T00:00:00Z' },
    })
    return Response.json({ items: [item('old-video'), item('new-video-a'), item('new-video-b')] })
  }
  return Response.json({ items: [] })
}

async function runImport() {
  return importChannelVideos({ userId: 'user-1', channelId: 'channel-1', bypassUserChannelGuard: true })
}

describe('import manuale senza lease: accodamento trascrizioni automatiche', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existingYoutubeIds = ['old-video']
    mocks.lastSyncAt = '2026-10-01T00:00:00Z'
    mocks.rpc.mockResolvedValue({ data: 2, error: null })
    mocks.fetchProvider.mockImplementation(async (input: { url: string }) => youtubeResponse(input.url))
    mocks.createAdminClient.mockReturnValue({ from, rpc: mocks.rpc })
  })

  it('passa alla RPC solo i video nuovi, non quelli già presenti', async () => {
    await runImport()

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_auto_transcriptions', {
      p_channel_id: 'channel-1',
      p_youtube_video_ids: ['new-video-a', 'new-video-b'],
    })
  })

  it('alla prima scansione del canale (nessuna sync precedente) non accoda nulla', async () => {
    mocks.lastSyncAt = null

    await runImport()

    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('non chiama la RPC se non ci sono video nuovi', async () => {
    mocks.existingYoutubeIds = ['old-video', 'new-video-a', 'new-video-b']

    await runImport()

    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un errore dell’accodamento non fa fallire l’import', async () => {
    mocks.rpc.mockRejectedValue(new Error('rpc down'))

    await expect(runImport()).resolves.toMatchObject({ channelId: 'channel-1', scannedCount: 3 })
  })
})
