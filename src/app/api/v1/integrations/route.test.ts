/* Commento didattico:
 * Scopo: verifica che l'API v1 accetti Firecrawl e restituisca pending senza esporre la chiave.
 * Moduli richiamati: route integrazioni, parser API v1 e service integrazioni mockati.
 * Flusso: esercita lo schema Zod reale senza chiamare provider o database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  requireApiUserMock,
  requireApiRateLimitMock,
  getStatusesMock,
  removeApiKeyMock,
  saveApiKeyMock,
  validateApiKeyMock,
} = vi.hoisted(() => ({
  requireApiUserMock: vi.fn(),
  requireApiRateLimitMock: vi.fn(() => null),
  getStatusesMock: vi.fn(),
  removeApiKeyMock: vi.fn(),
  saveApiKeyMock: vi.fn(),
  validateApiKeyMock: vi.fn(),
}))

vi.mock('@/lib/http/apiV1', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http/apiV1')>()
  return {
    ...actual,
    requireApiRateLimit: requireApiRateLimitMock,
    requireApiUser: requireApiUserMock,
  }
})

vi.mock('@/lib/services/integrations', () => ({
  getCredentialStatusesForUser: getStatusesMock,
  removeApiKey: removeApiKeyMock,
  saveApiKey: saveApiKeyMock,
  validateApiKey: validateApiKeyMock,
}))

import { DELETE, GET, POST } from '@/app/api/v1/integrations/route'

describe('POST /api/v1/integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireApiUserMock.mockResolvedValue({ user: { id: 'firecrawl-owner' }, supabase: {} })
    requireApiRateLimitMock.mockReturnValue(null)
    saveApiKeyMock.mockResolvedValue({
      provider: 'firecrawl',
      maskedKey: '********abcd',
      isValid: null,
      validationMessage: null,
      validationStatus: 'pending',
    })
    removeApiKeyMock.mockResolvedValue(undefined)
    getStatusesMock.mockResolvedValue([{ provider: 'firecrawl', isConfigured: false, isValid: null, validationStatus: 'idle', lastValidatedAt: null, lastUsedAt: null, lastError: null, maskedKey: null }])
  })

  it('accetta Firecrawl, accoda la verifica e non restituisce il segreto', async () => {
    const secret = 'test-firecrawl-api-key-secret'
    const response = await POST(new Request('http://localhost/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'firecrawl', action: 'save', apiKey: secret }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({ provider: 'firecrawl', isValid: null, validationStatus: 'pending', validationError: null })
    expect(payload.data).not.toHaveProperty('apiKey')
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(saveApiKeyMock).toHaveBeenCalledWith({
      userId: 'firecrawl-owner',
      provider: 'firecrawl',
      apiKey: secret,
      validateNow: true,
      supabase: {},
    })
    expect(validateApiKeyMock).not.toHaveBeenCalled()
  })

  it('protegge GET e DELETE con autenticazione e user scope', async () => {
    const userSupabase = {}
    requireApiUserMock.mockResolvedValue({ user: { id: 'firecrawl-owner' }, supabase: userSupabase })

    const statusResponse = await GET(new Request('http://localhost/api/v1/integrations'))
    expect(statusResponse.status).toBe(200)
    expect((await statusResponse.json()).data).toMatchObject([{ provider: 'firecrawl', isConfigured: false }])
    expect(getStatusesMock).toHaveBeenCalledWith('firecrawl-owner', userSupabase)

    const removeResponse = await DELETE(new Request('http://localhost/api/v1/integrations', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'firecrawl' }),
    }))
    expect(removeResponse.status).toBe(200)
    expect(removeApiKeyMock).toHaveBeenCalledWith({ userId: 'firecrawl-owner', provider: 'firecrawl', supabase: userSupabase })
  })

  it.each(['GET', 'POST', 'DELETE'] as const)('%s rifiuta l’accesso non autenticato', async (method) => {
    requireApiUserMock.mockResolvedValue(new Response(null, { status: 401 }))
    const response = method === 'GET'
      ? await GET(new Request('http://localhost/api/v1/integrations'))
      : method === 'POST'
        ? await POST(new Request('http://localhost/api/v1/integrations', {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'firecrawl', apiKey: 'test-firecrawl-key' }),
        }))
        : await DELETE(new Request('http://localhost/api/v1/integrations', {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'firecrawl' }),
        }))

    expect(response.status).toBe(401)
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(removeApiKeyMock).not.toHaveBeenCalled()
  })
})
