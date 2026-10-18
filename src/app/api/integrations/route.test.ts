/* Commento didattico:
 * Scopo: verifica il contratto HTTP standard delle operazioni integrazioni web.
 * Moduli richiamati: route integrations, servizi mockati e Vitest.
 * Flusso: controlla envelope e request ID per lettura, salvataggio e rimozione senza provider.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentSessionMock, getStatusesMock, saveApiKeyMock, validateApiKeyMock, removeApiKeyMock, runValidationJobMock, afterMock } = vi.hoisted(() => ({
  runValidationJobMock: vi.fn(),
  afterMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  getStatusesMock: vi.fn(),
  saveApiKeyMock: vi.fn(),
  validateApiKeyMock: vi.fn(),
  removeApiKeyMock: vi.fn(),
}))

vi.mock('@/lib/auth/provider', () => ({ getCurrentSession: getCurrentSessionMock }))
vi.mock('@/lib/services/integrations', () => ({
  getCredentialStatusesForUser: getStatusesMock,
  saveApiKey: saveApiKeyMock,
  validateApiKey: validateApiKeyMock,
  removeApiKey: removeApiKeyMock,
  runCredentialValidationJob: runValidationJobMock,
}))
vi.mock('next/server', () => ({ after: afterMock }))

import { AppError } from '@/lib/utils/errors'
import { DELETE, GET, POST } from './route'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

/** Crea una richiesta same-origin JSON con request ID controllabile dal chiamante. */
function makeRequest(method: 'POST' | 'DELETE', body: unknown): Request {
  return new Request('http://localhost/api/integrations', {
    method,
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'x-request-id': REQUEST_ID,
    },
    body: JSON.stringify(body),
  })
}

describe('/api/integrations HTTP envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentSessionMock.mockResolvedValue({ userId: 'owner-1' })
    getStatusesMock.mockResolvedValue([])
    saveApiKeyMock.mockResolvedValue({ provider: 'youtube', jobId: 'validation-job-save', maskedKey: '****1234', isValid: null, validationMessage: null, validationStatus: 'pending' })
    validateApiKeyMock.mockResolvedValue({ provider: 'youtube', jobId: 'validation-job-validate', isValid: true, message: null, validationStatus: 'pending' })
    removeApiKeyMock.mockResolvedValue(undefined)
  })

  it('risponde alla lettura con l’envelope standard e request ID nel body e header', async () => {
    const response = await GET(new Request('http://localhost/api/integrations', {
      headers: { 'x-request-id': REQUEST_ID },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(await response.json()).toEqual({ ok: true, data: [], requestId: REQUEST_ID })
  })

  it('risponde al salvataggio e alla rimozione mantenendo i dati attesi dal consumer', async () => {
    const saveResponse = await POST(makeRequest('POST', { provider: 'youtube', apiKey: 'success-case-test-marker', action: 'save' }))
    const saved = await saveResponse.json()
    const removeResponse = await DELETE(makeRequest('DELETE', { provider: 'youtube' }))

    expect(saveResponse.status).toBe(202)
    expect(saveResponse.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(saved).toEqual({ ok: true, data: expect.objectContaining({ jobId: 'validation-job-save', validationStatus: 'pending' }), requestId: REQUEST_ID })
    expect(removeResponse.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(await removeResponse.json()).toEqual({
      ok: true,
      data: { message: 'Chiave rimossa correttamente' },
      requestId: REQUEST_ID,
    })
  })

  it('lavora il job subito con after() restituendo la Promise del worker (ADR-014)', async () => {
    const workerPromise = Promise.resolve('worker-done')
    runValidationJobMock.mockReturnValue(workerPromise)

    const saveResponse = await POST(makeRequest('POST', { provider: 'youtube', apiKey: 'success-case-test-marker', action: 'save' }))
    expect(saveResponse.status).toBe(202)
    expect(afterMock).toHaveBeenCalledTimes(1)
    const callback = afterMock.mock.calls[0]?.[0] as () => unknown
    expect(callback()).toBe(workerPromise)
    expect(runValidationJobMock).toHaveBeenCalledWith('validation-job-save')

    const validateResponse = await POST(makeRequest('POST', { provider: 'youtube', action: 'validate' }))
    expect(validateResponse.status).toBe(202)
    expect(afterMock).toHaveBeenCalledTimes(2)
    ;(afterMock.mock.calls[1]?.[0] as () => unknown)()
    expect(runValidationJobMock).toHaveBeenLastCalledWith('validation-job-validate')
  })

  it('non schedula il worker se il job è già running presso un altro worker', async () => {
    validateApiKeyMock.mockResolvedValueOnce({ provider: 'youtube', jobId: 'job-running', isValid: null, message: null, validationStatus: 'running' })
    const response = await POST(makeRequest('POST', { provider: 'youtube', action: 'validate' }))
    expect(response.status).toBe(202)
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('restituisce 202 e jobId per una validazione asincrona', async () => {
    const response = await POST(makeRequest('POST', { provider: 'youtube', action: 'validate' }))
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload).toEqual({
      ok: true,
      data: expect.objectContaining({ jobId: 'validation-job-validate', validationStatus: 'pending' }),
      requestId: REQUEST_ID,
    })
  })

  it('non restituisce successo se il salvataggio non ha accodato il job', async () => {
    saveApiKeyMock.mockResolvedValueOnce({
      provider: 'youtube',
      jobId: null,
      maskedKey: '****1234',
      isValid: null,
      validationMessage: null,
      validationStatus: 'idle',
    })

    const response = await POST(makeRequest('POST', { provider: 'youtube', apiKey: 'test-key-marker', action: 'save' }))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Errore interno' } })
  })

  it('valida shape e provider prima dell’autenticazione senza esporre il segreto ricevuto', async () => {
    const secret = 'local-test-fixture-marker'
    const response = await POST(makeRequest('POST', { provider: 'unknown', apiKey: secret, action: 'save' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(response.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(payload).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' }, requestId: REQUEST_ID })
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(getCurrentSessionMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(validateApiKeyMock).not.toHaveBeenCalled()

    const missingKey = await POST(makeRequest('POST', { provider: 'youtube', action: 'save' }))
    expect(missingKey.status).toBe(400)
    expect(getCurrentSessionMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
  })

  it('nega un payload valido anonimo prima di chiamare i servizi', async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null)

    const response = await POST(makeRequest('POST', { provider: 'youtube', apiKey: 'test-payload-marker', action: 'save' }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(response.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(payload).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(validateApiKeyMock).not.toHaveBeenCalled()
  })

  it('valida il payload DELETE prima dell’autenticazione e non chiama la rimozione', async () => {
    const response = await DELETE(makeRequest('DELETE', { provider: 'unknown' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(response.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(payload).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    expect(getCurrentSessionMock).not.toHaveBeenCalled()
    expect(removeApiKeyMock).not.toHaveBeenCalled()
  })

  it('mappa errori applicativi e non espone dettagli interni nell’envelope', async () => {
    getCurrentSessionMock.mockRejectedValueOnce(new AppError('dettaglio privato', 'unknown', 500))

    const response = await GET(new Request('http://localhost/api/integrations', {
      headers: { 'x-request-id': REQUEST_ID },
    }))

    expect(response.status).toBe(500)
    expect(response.headers.get('X-Request-Id')).toBe(REQUEST_ID)
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Errore interno' },
      requestId: REQUEST_ID,
    })
  })

  it('mantiene il codice BFF INTERNAL_ERROR per temporary, distinto dal mapping v1', async () => {
    getCurrentSessionMock.mockRejectedValueOnce(new AppError('provider body must stay private', 'temporary', 503))

    const response = await GET(new Request('http://localhost/api/integrations', {
      headers: { 'x-request-id': REQUEST_ID },
    }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Errore interno' },
      requestId: REQUEST_ID,
    })
  })
})
