/* Commento didattico:
 * Scopo: verifica che l'API v1 accetti Firecrawl e restituisca pending senza esporre la chiave.
 * Moduli richiamati: route integrazioni, parser API v1 e service integrazioni mockati.
 * Flusso: esercita lo schema Zod reale senza chiamare provider o database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type ApiV1HttpHelpers = typeof import('@/lib/http/apiV1')

const {
  requireApiUserMock,
  requireApiRateLimitMock,
  getStatusesMock,
  removeApiKeyMock,
  saveApiKeyMock,
  validateApiKeyMock,
  runValidationJobMock,
  afterMock,
} = vi.hoisted(() => ({
  runValidationJobMock: vi.fn(),
  afterMock: vi.fn(),
  requireApiUserMock: vi.fn(),
  requireApiRateLimitMock: vi.fn(() => null),
  getStatusesMock: vi.fn(),
  removeApiKeyMock: vi.fn(),
  saveApiKeyMock: vi.fn(),
  validateApiKeyMock: vi.fn(),
}))

vi.mock('@/lib/http/apiV1', async (importOriginal) => {
  const actual = await importOriginal<ApiV1HttpHelpers>()
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
  runCredentialValidationJob: runValidationJobMock,
}))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: afterMock }))

import { DELETE, GET, POST } from '@/app/api/v1/integrations/route'
import { AppError } from '@/lib/utils/errors'

describe('POST /api/v1/integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireApiUserMock.mockResolvedValue({ user: { id: 'firecrawl-owner' }, supabase: {} })
    requireApiRateLimitMock.mockReturnValue(null)
    saveApiKeyMock.mockResolvedValue({
      provider: 'firecrawl',
      jobId: 'validation-job-1',
      maskedKey: '********abcd',
      isValid: null,
      validationMessage: null,
      validationStatus: 'pending',
    })
    removeApiKeyMock.mockResolvedValue(undefined)
    getStatusesMock.mockResolvedValue([{ provider: 'firecrawl', isConfigured: false, isValid: null, validationStatus: 'idle', lastValidatedAt: null, lastUsedAt: null, lastError: null, maskedKey: null }])
  })

  it('lavora il job di salvataggio e validazione con after() restituendo la Promise del worker', async () => {
    const workerPromise = Promise.resolve('worker-done')
    runValidationJobMock.mockReturnValue(workerPromise)
    validateApiKeyMock.mockResolvedValue({ provider: 'firecrawl', jobId: 'validation-job-2', isValid: null, message: null, validationStatus: 'pending' })
    const post = (body: unknown) => POST(new Request('http://localhost/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))

    expect((await post({ provider: 'firecrawl', action: 'save', apiKey: 'test-firecrawl-api-key-secret' })).status).toBe(202)
    expect((await post({ provider: 'firecrawl', action: 'validate' })).status).toBe(202)

    expect(afterMock).toHaveBeenCalledTimes(2)
    expect((afterMock.mock.calls[0]?.[0] as () => unknown)()).toBe(workerPromise)
    expect(runValidationJobMock).toHaveBeenNthCalledWith(1, 'validation-job-1')
    ;(afterMock.mock.calls[1]?.[0] as () => unknown)()
    expect(runValidationJobMock).toHaveBeenNthCalledWith(2, 'validation-job-2')
  })

  it('accetta Firecrawl, accoda la verifica e non restituisce il segreto', async () => {
    const secret = 'test-firecrawl-api-key-secret'
    const response = await POST(new Request('http://localhost/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'firecrawl', action: 'save', apiKey: secret }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload.data).toMatchObject({ provider: 'firecrawl', jobId: 'validation-job-1', isValid: null, validationStatus: 'pending', validationError: null })
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

  it('restituisce HTTP 202 e jobId quando una validazione viene accodata', async () => {
    validateApiKeyMock.mockResolvedValue({
      provider: 'firecrawl',
      jobId: 'validation-job-2',
      isValid: null,
      message: null,
      validationStatus: 'pending',
    })

    const response = await POST(new Request('http://localhost/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'firecrawl', action: 'validate' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload.data).toMatchObject({ provider: 'firecrawl', jobId: 'validation-job-2', validationStatus: 'pending' })
    expect(validateApiKeyMock).toHaveBeenCalledWith({ userId: 'firecrawl-owner', provider: 'firecrawl', supabase: {} })
  })

  it('non segnala una mutazione asincrona riuscita se il service non restituisce jobId', async () => {
    const secret = 'test-firecrawl-key-without-job'
    saveApiKeyMock.mockResolvedValueOnce({
      provider: 'firecrawl',
      jobId: null,
      maskedKey: '********with',
      isValid: null,
      validationMessage: null,
      validationStatus: 'pending',
    })

    const response = await POST(new Request('http://localhost/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'firecrawl', action: 'save', apiKey: secret }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Errore interno' } })
    expect(JSON.stringify(payload)).not.toContain(secret)
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

  it('valida POST e DELETE prima del Bearer e non accede a servizi con payload invalidi', async () => {
    const secret = 'must-not-appear-in-validation-errors'
    const postResponse = await POST(new Request('http://localhost/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'unknown', action: 'save', apiKey: secret }),
    }))
    const postPayload = await postResponse.json()

    expect(postResponse.status).toBe(400)
    expect(postPayload).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    expect(JSON.stringify(postPayload)).not.toContain(secret)
    expect(requireApiUserMock).not.toHaveBeenCalled()
    expect(requireApiRateLimitMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()

    const missingKeyResponse = await POST(new Request('http://localhost/api/v1/integrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'firecrawl', action: 'save' }),
    }))
    expect(missingKeyResponse.status).toBe(400)
    expect(requireApiUserMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()

    const deleteResponse = await DELETE(new Request('http://localhost/api/v1/integrations', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: secret }),
    }))
    expect(deleteResponse.status).toBe(400)
    expect(requireApiUserMock).not.toHaveBeenCalled()
    expect(removeApiKeyMock).not.toHaveBeenCalled()
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

  it('mappa temporary a UPSTREAM_ERROR per il contratto specifico di v1', async () => {
    requireApiUserMock.mockRejectedValueOnce(new AppError('private provider detail', 'temporary', 503))

    const response = await GET(new Request('http://localhost/api/v1/integrations'))
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload).toMatchObject({ ok: false, error: { code: 'UPSTREAM_ERROR', message: 'Errore interno' } })
    expect(JSON.stringify(payload)).not.toContain('private provider detail')
  })
})
