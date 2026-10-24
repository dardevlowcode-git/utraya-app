/* Commento didattico:
 * Scopo del file: testa il contratto della route canali per i warning non bloccanti.
 * Moduli richiamati: `@/app/api/channels/route`, `@/lib/auth/provider`, `@/lib/services/channels`, `vitest`
 * Flusso: Simula sessione e service layer per verificare payload HTTP della POST.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const getCurrentSessionMock = vi.fn()
const addChannelForUserMock = vi.fn()
const requestScanNowForUserMock = vi.fn()
const afterMock = vi.fn()
const runAutoTranscriptionsMock = vi.fn()

vi.mock('@/lib/auth/provider', () => ({
  getCurrentSession: getCurrentSessionMock,
}))

vi.mock('@/lib/services/channels', () => ({
  addChannelForUser: addChannelForUserMock,
  getChannelsForUser: vi.fn(),
  removeChannelForUser: vi.fn(),
  requestScanNowForUser: requestScanNowForUserMock,
}))

vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: afterMock }))
vi.mock('@/lib/services/transcription-auto', () => ({ runAutoTranscriptionsForChannel: runAutoTranscriptionsMock }))

let GET: typeof import('@/app/api/channels/route').GET
let POST: typeof import('@/app/api/channels/route').POST
let DELETE: typeof import('@/app/api/channels/route').DELETE

describe('POST /api/channels', () => {
  beforeAll(async () => {
    ;({ GET, POST, DELETE } = await import('@/app/api/channels/route'))
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

  it('risponde 401 senza sessione per GET, POST e DELETE', async () => {
    getCurrentSessionMock.mockResolvedValue(null)
    const postRequest = () => new Request('http://localhost/api/channels', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@test' }),
    })
    const deleteRequest = () => new Request('http://localhost/api/channels', {
      method: 'DELETE',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ channelId: 'channel-test' }),
    })

    expect((await GET()).status).toBe(401)
    expect((await POST(postRequest())).status).toBe(401)
    expect((await DELETE(deleteRequest())).status).toBe(401)
    expect(addChannelForUserMock).not.toHaveBeenCalled()
    expect(requestScanNowForUserMock).not.toHaveBeenCalled()
  })

  it('rifiuta origin diverso con 403 prima di leggere la sessione', async () => {
    const response = await POST(new Request('http://localhost/api/channels', {
      method: 'POST',
      headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@test' }),
    }))

    expect(response.status).toBe(403)
    expect(getCurrentSessionMock).not.toHaveBeenCalled()
    expect(addChannelForUserMock).not.toHaveBeenCalled()
  })

  it('rifiuta content-type non JSON con 415 prima di leggere la sessione', async () => {
    const response = await POST(new Request('http://localhost/api/channels', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'text/plain' },
      body: 'channelUrl=https://www.youtube.com/@test',
    }))

    expect(response.status).toBe(415)
    expect(getCurrentSessionMock).not.toHaveBeenCalled()
    expect(addChannelForUserMock).not.toHaveBeenCalled()
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

  it('dopo aggiunta e scan manuale avvia in after() la trascrizione automatica del canale', async () => {
    addChannelForUserMock.mockResolvedValue({
      channelId: 'channel-1', normalizedChannelUrl: 'https://www.youtube.com/@test',
      initialScanError: null, scanBlockedReason: null, markedSeenCount: 0,
    })
    requestScanNowForUserMock.mockResolvedValue({ queued: true, jobId: 'job-1', deduplicated: false })
    const post = (body: unknown) => POST(new Request('http://localhost/api/channels', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))

    expect((await post({ channelUrl: 'https://www.youtube.com/@test' })).status).toBe(200)
    expect((await post({ action: 'scan_now', channelId: 'channel-2' })).status).toBe(200)

    expect(afterMock).toHaveBeenCalledTimes(2)
    // after() riceve una funzione che restituisce la Promise del worker (ADR-014).
    for (const [callback] of afterMock.mock.calls) await (callback as () => Promise<unknown>)()
    expect(runAutoTranscriptionsMock.mock.calls).toEqual([['channel-1'], ['channel-2']])
  })
})
