/* Commento didattico:
 * Scopo del file: testa le guardie del broker api-verifier senza OIDC reale ne` chiamate live.
 * Moduli richiamati: route broker con OIDC, replay e suite verifier mockati, `vitest`.
 * Flusso: verifica validazione, target, auth OIDC, flag mutazioni e report delegato.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyOidcMock, consumeJtiMock, runVerificationMock } = vi.hoisted(() => ({
  verifyOidcMock: vi.fn(),
  consumeJtiMock: vi.fn(),
  runVerificationMock: vi.fn(),
}))

vi.mock('@/lib/security/githubOidc', () => ({
  verifyGitHubActionsOidc: verifyOidcMock,
}))

vi.mock('@/lib/security/githubOidcReplay', () => ({
  consumeGitHubOidcJti: consumeJtiMock,
}))

vi.mock('@/lib/verifier/api-verifier', () => ({
  verifierTargetOrigins: { preview: 'https://preview.utraya.com', production: 'https://utraya.com' },
  runApiVerification: runVerificationMock,
}))

// Import statico dopo i mock: vitest solleva le factory prima dell'import.
import { POST } from '@/app/api/internal/api-verifier/route'

function brokerRequest(body: unknown, ip: string) {
  return new Request('https://preview.utraya.com/api/internal/api-verifier', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, authorization: 'Bearer oidc-test' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/api-verifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyOidcMock.mockResolvedValue({ jti: 'jti-broker-1', exp: 9_999_999_999 })
    consumeJtiMock.mockResolvedValue(undefined)
    runVerificationMock.mockResolvedValue({ schemaVersion: 1, target: 'preview', summary: { status: 'passed' }, checks: [], failedCount: 0 })
    vi.stubEnv('API_E2E_ALLOW_MUTATIONS', 'false')
  })

  it('rifiuta il payload non valido con 400', async () => {
    const response = await POST(brokerRequest({ target: 'staging' }, '10.0.0.1'))
    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rifiuta OIDC non valido con 401 senza eseguire la suite', async () => {
    verifyOidcMock.mockRejectedValue(new Error('OIDC claims non autorizzati'))
    const response = await POST(brokerRequest({ target: 'preview' }, '10.0.0.2'))
    expect(response.status).toBe(401)
    expect(consumeJtiMock).not.toHaveBeenCalled()
    expect(runVerificationMock).not.toHaveBeenCalled()
  })

  it('blocca le mutazioni quando il flag server e` spento', async () => {
    const response = await POST(brokerRequest({ target: 'preview', mutations: true }, '10.0.0.3'))
    expect(response.status).toBe(403)
    expect(runVerificationMock).not.toHaveBeenCalled()
  })

  it('delega la suite e restituisce il report con no-store', async () => {
    const response = await POST(brokerRequest({ target: 'preview' }, '10.0.0.4'))
    expect(response.status).toBe(200)
    expect(consumeJtiMock).toHaveBeenCalledWith('jti-broker-1', 9_999_999_999)
    const payload = (await response.json()) as { ok: boolean; data: { target: string }; requestId: string }
    expect(payload.data.target).toBe('preview')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
