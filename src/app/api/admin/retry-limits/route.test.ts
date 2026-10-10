/* Commento didattico:
 * Scopo del file: verifica il confine HTTP admin per leggere e salvare i limiti retry.
 * Moduli richiamati: route admin, auth admin, service retry-limits e vitest.
 * Flusso: prova autorizzazione admin, limiti validi/invalidi e separazione della chiave YouTube condivisa.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdminSessionMock, getAdminRetryLimitsMock, setCredentialRetryLimitMock, setSharedYoutubeRetryLimitMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  getAdminRetryLimitsMock: vi.fn(),
  setCredentialRetryLimitMock: vi.fn(),
  setSharedYoutubeRetryLimitMock: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({ getAdminSession: getAdminSessionMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/services/retry-limits', () => ({
  getAdminRetryLimits: getAdminRetryLimitsMock,
  setCredentialRetryLimit: setCredentialRetryLimitMock,
  setSharedYoutubeRetryLimit: setSharedYoutubeRetryLimitMock,
}))

import { GET, PUT } from '@/app/api/admin/retry-limits/route'

const retryLimits = {
  credentials: [],
  sharedYoutube: {
    providerKey: 'youtube_innertube',
    identifier: 'YOUTUBEI_API_KEY',
    retryLimit: 10,
    maxAttempts: 11,
    active: false,
  },
}

function adminRequest(method: 'GET' | 'PUT', body?: unknown): Request {
  return new Request('http://localhost/api/admin/retry-limits', {
    method,
    headers: method === 'PUT' ? { origin: 'http://localhost', 'content-type': 'application/json' } : {},
    body: method === 'PUT' ? JSON.stringify(body) : undefined,
  })
}

describe('admin retry limits route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAdminSessionMock.mockResolvedValue({ username: 'admin' })
    getAdminRetryLimitsMock.mockResolvedValue(retryLimits)
    setCredentialRetryLimitMock.mockResolvedValue({ credentialId: '00000000-0000-4000-8000-000000000001', retryLimit: 1 })
    setSharedYoutubeRetryLimitMock.mockResolvedValue({ providerKey: 'youtube_innertube', retryLimit: 10 })
  })

  it('nega il GET a sessioni non admin senza leggere i limiti', async () => {
    getAdminSessionMock.mockResolvedValue(null)

    const response = await GET(adminRequest('GET'))

    expect(response.status).toBe(401)
    expect(getAdminRetryLimitsMock).not.toHaveBeenCalled()
  })

  it('nega il PUT a sessioni non admin', async () => {
    getAdminSessionMock.mockResolvedValue(null)

    const response = await PUT(adminRequest('PUT', {
      scope: 'credential',
      credentialId: '00000000-0000-4000-8000-000000000001',
      retryLimit: 1,
    }))

    expect(response.status).toBe(401)
    expect(setCredentialRetryLimitMock).not.toHaveBeenCalled()
  })

  it('espone soltanto view model di limiti e la chiave condivisa separata', async () => {
    const response = await GET(adminRequest('GET'))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ ok: true, data: retryLimits })
    expect(JSON.stringify(payload)).not.toContain('encrypted_key')
  })

  it.each([0, 1, 10, 2147483647])('accetta il limite intero %i per una credenziale privata', async (retryLimit) => {
    const response = await PUT(adminRequest('PUT', {
      scope: 'credential',
      credentialId: '00000000-0000-4000-8000-000000000001',
      retryLimit,
    }))

    expect(response.status).toBe(200)
    expect(setCredentialRetryLimitMock).toHaveBeenCalledWith({}, '00000000-0000-4000-8000-000000000001', retryLimit)
  })

  it('salva separatamente il limite della chiave pubblica condivisa', async () => {
    const response = await PUT(adminRequest('PUT', { scope: 'shared-youtube', retryLimit: 0 }))

    expect(response.status).toBe(200)
    expect(setSharedYoutubeRetryLimitMock).toHaveBeenCalledWith({}, 0)
    expect(setCredentialRetryLimitMock).not.toHaveBeenCalled()
  })

  it.each([-1, 1.5, 2147483648, '10', null])('rifiuta il retry limit non valido %s', async (retryLimit) => {
    const response = await PUT(adminRequest('PUT', {
      scope: 'credential',
      credentialId: '00000000-0000-4000-8000-000000000001',
      retryLimit,
    }))

    expect(response.status).toBe(400)
    expect(setCredentialRetryLimitMock).not.toHaveBeenCalled()
  })

  it('rifiuta payload utente che provano a impostare campi di secret', async () => {
    const response = await PUT(adminRequest('PUT', {
      scope: 'credential',
      credentialId: '00000000-0000-4000-8000-000000000001',
      retryLimit: 0,
      encrypted_key: 'must-not-be-accepted',
    }))

    expect(response.status).toBe(400)
    expect(setCredentialRetryLimitMock).not.toHaveBeenCalled()
  })
})
