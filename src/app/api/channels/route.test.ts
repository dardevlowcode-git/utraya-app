/* Commento didattico:
 * Scopo del file: testa il contratto della route canali per i warning non bloccanti.
 * Moduli richiamati: `@/app/api/channels/route`, `@/lib/auth/provider`, `@/lib/services/channels`, `vitest`
 * Flusso: Simula sessione e service layer per verificare payload HTTP della POST.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const getCurrentSessionMock = vi.fn()
const addChannelForUserMock = vi.fn()

vi.mock('@/lib/auth/provider', () => ({
  getCurrentSession: getCurrentSessionMock,
}))

vi.mock('@/lib/services/channels', () => ({
  addChannelForUser: addChannelForUserMock,
  getChannelsForUser: vi.fn(),
  removeChannelForUser: vi.fn(),
  requestScanNowForUser: vi.fn(),
}))

let POST: typeof import('@/app/api/channels/route').POST

describe('POST /api/channels', () => {
  beforeAll(async () => {
    ;({ POST } = await import('@/app/api/channels/route'))
  })

  beforeEach(() => {
    vi.resetAllMocks()
    getCurrentSessionMock.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      avatarUrl: null,
      role: 'user',
      preferredLanguage: 'it',
    })
  })

  it('restituisce warningCode quando manca API key YouTube', async () => {
    addChannelForUserMock.mockResolvedValue({
      channelId: 'channel-1',
      normalizedChannelUrl: 'https://www.youtube.com/@test',
      initialScanError: null,
      scanBlockedReason: 'missing_youtube_api_key',
      markedSeenCount: 0,
    })

    const request = new Request('http://localhost/api/channels', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@test' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.data.warningCode).toBe('missing_youtube_api_key')
    expect(payload.data.message).toContain('Scansione in pausa')
    expect(typeof payload.requestId).toBe('string')
  })

  it('non restituisce warningCode quando la scansione non è bloccata', async () => {
    addChannelForUserMock.mockResolvedValue({
      channelId: 'channel-1',
      normalizedChannelUrl: 'https://www.youtube.com/@test',
      initialScanError: null,
      scanBlockedReason: null,
      markedSeenCount: 0,
    })

    const request = new Request('http://localhost/api/channels', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@test' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.data.warningCode).toBeNull()
    expect(payload.data.message).toBe('Canale aggiunto correttamente')
  })
})
