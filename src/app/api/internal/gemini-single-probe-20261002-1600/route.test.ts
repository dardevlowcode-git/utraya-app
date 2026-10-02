/* Commento didattico:
 * Scopo: verifica il no-store e gli status invariati della route temporanea T8.
 * Moduli richiamati: route handler e service probe mocked.
 * Flusso: esercita successi, errori e rifiuti di auth/ambiente senza DB o provider.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  claimSingleProbeInThisRuntime: vi.fn(),
  executeGeminiSingleProbe: vi.fn(),
  getGeminiSingleProbeReadiness: vi.fn(),
  getGeminiSingleProbeReadback: vi.fn(),
}))

vi.mock('@/lib/services/gemini-single-probe-20261002-1600', () => ({
  ...serviceMocks,
  isSingleProbeAuthorized: (request: Request) => {
    const expected = process.env.GEMINI_SINGLE_TOKEN_20261002_1600
    return Boolean(expected && request.headers.get('authorization') === `Bearer ${expected}`)
  },
  isSingleProbeDevDeployment: () => process.env.VERCEL_ENV === 'production' && process.env.VERCEL_GIT_COMMIT_REF === 'dev',
}))

import { GET, POST } from './route'

const TOKEN_ENV_NAME = 'GEMINI_SINGLE_TOKEN_20261002_1600'

function request(method: 'GET' | 'POST', authorized = false) {
  const expiry = Math.floor(Date.now() / 1000) + 120
  const token = `${expiry}.${'a'.repeat(43)}`
  process.env[TOKEN_ENV_NAME] = token
  return new Request('https://dev.utraya.com/api/internal/gemini-single-probe-20261002-1600', {
    method,
    headers: authorized ? { authorization: `Bearer ${token}` } : {},
  })
}

async function expectNoStore(response: Response, expectedStatus: number) {
  expect(response.status).toBe(expectedStatus)
  expect(response.headers.get('cache-control')).toBe('no-store')
}

describe('temporary Gemini route response caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env[TOKEN_ENV_NAME]
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_GIT_COMMIT_REF = 'dev'
    serviceMocks.claimSingleProbeInThisRuntime.mockReturnValue(true)
    serviceMocks.executeGeminiSingleProbe.mockResolvedValue({ ok: true, model: 'gemini-3.5-flash-lite' })
    serviceMocks.getGeminiSingleProbeReadback.mockResolvedValue(null)
    serviceMocks.getGeminiSingleProbeReadiness.mockResolvedValue({ ok: true, mode: 'ready', ready: true })
  })

  it('imposta no-store su 404 e 401 per entrambi i metodi', async () => {
    process.env.VERCEL_ENV = 'preview'
    await expectNoStore(await GET(request('GET')), 404)
    await expectNoStore(await POST(request('POST')), 404)

    process.env.VERCEL_ENV = 'production'
    await expectNoStore(await GET(request('GET')), 401)
    await expectNoStore(await POST(request('POST')), 401)
  })

  it('mantiene 200 e no-store sul GET readiness positivo', async () => {
    const response = await GET(request('GET', true))
    await expectNoStore(response, 200)
    expect(await response.json()).toMatchObject({ ok: true, mode: 'ready', ready: true })
  })

  it('mantiene 409/no-store sul GET readback non riuscito e 500/no-store su eccezione', async () => {
    serviceMocks.getGeminiSingleProbeReadback.mockResolvedValue({ ok: false, mode: 'readback', failure: 'readback_unavailable' })
    await expectNoStore(await GET(request('GET', true)), 409)

    serviceMocks.getGeminiSingleProbeReadback.mockRejectedValue(new Error('private database detail'))
    await expectNoStore(await GET(request('GET', true)), 500)
  })

  it('mantiene 409/no-store per claim duplicato', async () => {
    serviceMocks.claimSingleProbeInThisRuntime.mockReturnValue(false)
    await expectNoStore(await POST(request('POST', true)), 409)
    expect(serviceMocks.executeGeminiSingleProbe).not.toHaveBeenCalled()
  })

  it('mantiene 200/no-store sul POST positivo e 500/no-store su eccezione', async () => {
    const success = await POST(request('POST', true))
    await expectNoStore(success, 200)
    expect(await success.json()).toMatchObject({ ok: true })

    serviceMocks.executeGeminiSingleProbe.mockRejectedValue(new Error('private provider detail'))
    serviceMocks.claimSingleProbeInThisRuntime.mockReturnValue(true)
    await expectNoStore(await POST(request('POST', true)), 500)
  })
})
