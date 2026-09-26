/* Commento didattico:
 * Scopo del file: testa il contratto della route v1 canali senza database o provider reali.
 * Moduli richiamati: route `v1/channels`, auth e service mockati, `vitest`.
 * Flusso: simula Bearer user e service per happy-path, auth, validazione e rate limit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiUserContext } from '@/lib/auth/apiUser'

const { getApiUserMock, getChannelsForUserMock, removeChannelForUserMock, queueChannelScanMock, addChannelAndQueueScanMock, afterMock } = vi.hoisted(() => ({
  getApiUserMock: vi.fn(),
  getChannelsForUserMock: vi.fn(),
  removeChannelForUserMock: vi.fn(),
  queueChannelScanMock: vi.fn(),
  addChannelAndQueueScanMock: vi.fn(),
  afterMock: vi.fn(),
}))

vi.mock('@/lib/auth/apiUser', () => ({
  getApiUser: getApiUserMock,
}))

vi.mock('@/lib/services/channels', () => ({
  getChannelsForUser: getChannelsForUserMock,
  removeChannelForUser: removeChannelForUserMock,
}))

vi.mock('@/lib/services/channel-scan-actions', () => ({
  queueChannelScan: queueChannelScanMock,
  addChannelAndQueueScan: addChannelAndQueueScanMock,
}))

vi.mock('next/server', () => ({
  after: afterMock,
}))

// Import statico dopo i mock: vitest solleva le factory prima dell'import.
import { DELETE, GET, POST } from '@/app/api/v1/channels/route'

const CHANNEL_UUID = '123e4567-e89b-12d3-a456-426614174000'

function authedUser(userId = 'user-1'): ApiUserContext {
  return {
    user: { id: userId, email: 'user1@example.com' },
    supabase: {},
  } as unknown as ApiUserContext
}

function jsonRequest(url: string, method: string, body: unknown, userId?: string) {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(userId ? { 'x-test-user': userId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('GET /api/v1/channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiUserMock.mockResolvedValue(authedUser())
  })

  it('restituisce i canali mappati nel view model con requestId', async () => {
    getChannelsForUserMock.mockResolvedValue([
      {
        userChannel: { added_at: '2026-09-01T10:00:00.000Z' },
        channel: { id: 'c1', youtube_channel_id: 'UC1', handle: '@c1', title: 'C1', description: null, thumbnail_url: null, custom_url: null },
        preferences: null,
        syncState: null,
      },
    ])
    const response = await GET(new Request('http://localhost/api/v1/channels'))
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBeTruthy()
    const payload = (await response.json()) as { ok: boolean; data: Array<{ id: string }>; requestId: string }
    expect(payload.ok).toBe(true)
    expect(payload.data[0].id).toBe('c1')
    expect(typeof payload.requestId).toBe('string')
    expect(getChannelsForUserMock).toHaveBeenCalledWith('user-1', expect.anything())
  })

  it('rifiuta senza Bearer con 401', async () => {
    getApiUserMock.mockResolvedValue(null)
    const response = await GET(new Request('http://localhost/api/v1/channels'))
    expect(response.status).toBe(401)
    const payload = (await response.json()) as { ok: boolean; error: { code: string }; requestId: string }
    expect(payload.error.code).toBe('UNAUTHORIZED')
    expect(typeof payload.requestId).toBe('string')
  })
})

describe('POST /api/v1/channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiUserMock.mockResolvedValue(authedUser())
  })

  it('accoda scan_now con 202 e schedula il background', async () => {
    const background = vi.fn().mockResolvedValue(undefined)
    queueChannelScanMock.mockResolvedValue({ jobId: 'job-1', deduplicated: false, background })
    const response = await POST(jsonRequest('http://localhost/api/v1/channels', 'POST', { action: 'scan_now', channelId: CHANNEL_UUID }))
    expect(response.status).toBe(202)
    const payload = (await response.json()) as { ok: boolean; data: { jobId: string; deduplicated: boolean } }
    expect(payload.data).toMatchObject({ jobId: 'job-1', deduplicated: false })
    expect(afterMock).toHaveBeenCalledTimes(1)
    expect(queueChannelScanMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', channelId: CHANNEL_UUID, source: 'manual_scan' }))
  })

  it('valida channelUrl obbligatorio per action add', async () => {
    const response = await POST(jsonRequest('http://localhost/api/v1/channels', 'POST', { action: 'add' }))
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: { code: string } }
    expect(payload.error.code).toBe('VALIDATION_FAILED')
  })

  it('applica il rate limit 429 con Retry-After oltre la soglia', async () => {
    getApiUserMock.mockResolvedValue(authedUser('rate-user'))
    queueChannelScanMock.mockResolvedValue({ jobId: 'job-x', deduplicated: false, background: null })
    let last: Response | null = null
    for (let attempt = 0; attempt < 61; attempt += 1) {
      last = await POST(jsonRequest('http://localhost/api/v1/channels', 'POST', { action: 'scan_now', channelId: CHANNEL_UUID }))
    }
    expect(last?.status).toBe(429)
    expect(last?.headers.get('Retry-After')).toBeTruthy()
    const payload = (await last?.json()) as { error: { code: string }; requestId: string }
    expect(payload.error.code).toBe('RATE_LIMITED')
    expect(typeof payload.requestId).toBe('string')
  })
})

describe('DELETE /api/v1/channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiUserMock.mockResolvedValue(authedUser())
  })

  it('rimuove solo il canale di proprieta` via service user-scoped', async () => {
    removeChannelForUserMock.mockResolvedValue({ removed: true })
    const response = await DELETE(jsonRequest('http://localhost/api/v1/channels', 'DELETE', { channelId: CHANNEL_UUID }))
    expect(response.status).toBe(200)
    expect(removeChannelForUserMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', channelId: CHANNEL_UUID }))
  })
})
