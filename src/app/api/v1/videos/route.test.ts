/* Commento didattico:
 * Scopo del file: verifica il contratto asincrono dell'import video API v1.
 * Moduli richiamati: route video, autenticazione e coda scan mockate, `vitest`.
 * Flusso: controlla che il callback registrato con `after` restituisca il lavoro background.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireApiUserMock, readApiJsonMock, queueChannelScanMock, afterMock } = vi.hoisted(() => ({
  requireApiUserMock: vi.fn(),
  readApiJsonMock: vi.fn(),
  queueChannelScanMock: vi.fn(),
  afterMock: vi.fn(),
}))

vi.mock('@/lib/http/apiV1', () => ({
  apiV1Error: vi.fn(() => new Response(null, { status: 500 })),
  apiV1Validation: vi.fn(() => new Response(null, { status: 400 })),
  getApiRequestId: vi.fn(() => 'request-1'),
  readApiJson: readApiJsonMock,
  requireApiJson: vi.fn(),
  requireApiRateLimit: vi.fn(() => null),
  requireApiUser: requireApiUserMock,
}))

vi.mock('@/lib/services/channel-scan-actions', () => ({
  queueChannelScan: queueChannelScanMock,
}))

vi.mock('@/lib/services/videos', () => ({
  getVideosForUser: vi.fn(),
  setVideoSeenStatusForUser: vi.fn(),
  setVideoWatchlistForUser: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: afterMock,
}))

import { POST } from '@/app/api/v1/videos/route'

const CHANNEL_UUID = '123e4567-e89b-12d3-a456-426614174000'

describe('POST /api/v1/videos import_channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireApiUserMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    readApiJsonMock.mockResolvedValue({ action: 'import_channel', channelId: CHANNEL_UUID })
  })

  it('restituisce a after la Promise del worker così il runtime ne attende il completamento', async () => {
    let releaseBackground!: () => void
    const backgroundPromise = new Promise<void>((resolve) => { releaseBackground = resolve })
    const background = vi.fn(() => backgroundPromise)
    queueChannelScanMock.mockResolvedValue({ jobId: 'job-1', deduplicated: false, background })

    const request = new Request('http://localhost/api/v1/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'import_channel', channelId: CHANNEL_UUID }),
    })
    const response = await POST(request)

    expect(response.status).toBe(202)
    expect(queueChannelScanMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      channelId: CHANNEL_UUID,
      source: 'import_channel',
    }))

    const scheduledCallback = afterMock.mock.calls[0]?.[0] as (() => unknown) | undefined
    expect(scheduledCallback).toBeTypeOf('function')
    let scheduledWork: unknown
    try {
      scheduledWork = scheduledCallback?.()
      expect(scheduledWork).toBe(backgroundPromise)
      expect(background).toHaveBeenCalledOnce()
    } finally {
      releaseBackground()
    }
    await scheduledWork
  })
})
