/* Commento didattico:
 * Scopo del file: verifica autenticazione, isolamento per utente, validazione e limite HTTP della watchlist v1.
 * Moduli richiamati: route handler, auth Bearer, servizi watchlist/video e rate limiter.
 * Flusso: chiama i metodi HTTP reali e osserva le risposte e gli argomenti dei service boundary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiUserContext } from '@/lib/auth/apiUser'
import { resetRateLimits } from '@/lib/security/rate-limit'

const { getApiUserMock, getWatchlistForUserMock, setVideoWatchlistForUserMock, removeVideoFromWatchlistMock } = vi.hoisted(() => ({
  getApiUserMock: vi.fn(),
  getWatchlistForUserMock: vi.fn(),
  setVideoWatchlistForUserMock: vi.fn(),
  removeVideoFromWatchlistMock: vi.fn(),
}))

vi.mock('@/lib/auth/apiUser', () => ({ getApiUser: getApiUserMock }))
vi.mock('@/lib/services/watchlist', () => ({
  getWatchlistForUser: getWatchlistForUserMock,
  removeVideoFromWatchlist: removeVideoFromWatchlistMock,
}))
vi.mock('@/lib/services/videos', () => ({ setVideoWatchlistForUser: setVideoWatchlistForUserMock }))

import { DELETE, GET, POST } from './route'

const VIDEO_ID = '5f1a3b1e-0000-4000-8000-000000000001'
const supabase = { testClient: true }

function apiUser(userId = 'token-user'): ApiUserContext {
  return { user: { id: userId, email: 'token@example.test' }, supabase } as unknown as ApiUserContext
}

function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/v1/watchlist', {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

describe('/api/v1/watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimits()
    getApiUserMock.mockResolvedValue(apiUser())
    getWatchlistForUserMock.mockResolvedValue([])
    setVideoWatchlistForUserMock.mockResolvedValue({ updated: true })
    removeVideoFromWatchlistMock.mockResolvedValue({ removed: true })
  })

  it('rifiuta anonimi su GET, POST e DELETE senza invocare i service', async () => {
    getApiUserMock.mockResolvedValue(null)

    expect((await GET(request('GET'))).status).toBe(401)
    expect((await POST(request('POST', { videoId: VIDEO_ID }))).status).toBe(401)
    expect((await DELETE(request('DELETE', { videoId: VIDEO_ID }))).status).toBe(401)
    expect(getWatchlistForUserMock).not.toHaveBeenCalled()
    expect(setVideoWatchlistForUserMock).not.toHaveBeenCalled()
    expect(removeVideoFromWatchlistMock).not.toHaveBeenCalled()
  })

  it('lega GET all’utente autenticato', async () => {
    const response = await GET(request('GET'))

    expect(response.status).toBe(200)
    expect(getWatchlistForUserMock).toHaveBeenCalledWith('token-user', supabase)
  })

  it('lega POST e DELETE all’utente autenticato', async () => {
    expect((await POST(request('POST', { videoId: VIDEO_ID }))).status).toBe(200)
    expect((await DELETE(request('DELETE', { videoId: VIDEO_ID }))).status).toBe(200)

    expect(setVideoWatchlistForUserMock).toHaveBeenCalledWith({
      userId: 'token-user', videoId: VIDEO_ID, inWatchlist: true, supabase,
    })
    expect(removeVideoFromWatchlistMock).toHaveBeenCalledWith({ userId: 'token-user', videoId: VIDEO_ID, supabase })
  })

  it.each(['POST', 'DELETE'] as const)('%s rifiuta input non UUID senza modificare la watchlist', async (method) => {
    const response = method === 'POST'
      ? await POST(request(method, { videoId: 'not-a-uuid' }))
      : await DELETE(request(method, { videoId: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    expect(setVideoWatchlistForUserMock).not.toHaveBeenCalled()
    expect(removeVideoFromWatchlistMock).not.toHaveBeenCalled()
  })

  it('limita le modifiche e restituisce Retry-After oltre soglia', async () => {
    let response: Response | undefined
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await POST(request('POST', { videoId: VIDEO_ID }))
    }

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBeTruthy()
    expect(await response?.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
    expect(setVideoWatchlistForUserMock).toHaveBeenCalledTimes(60)
  })
})
