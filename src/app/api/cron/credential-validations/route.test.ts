/* Commento didattico:
 * Scopo del file: verifica la guardia cron e il dispatch del worker persistente delle verifiche API.
 * Moduli richiamati: route cron, service job validation e vitest.
 * Flusso: rifiuta chiamate non autorizzate e usa la secret solo per il trigger, mai nel risultato.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { processPendingCredentialValidationJobsMock, performCredentialValidationAttemptMock } = vi.hoisted(() => ({
  processPendingCredentialValidationJobsMock: vi.fn(),
  performCredentialValidationAttemptMock: vi.fn(),
}))

vi.mock('@/lib/services/credential-validation-jobs', () => ({
  processPendingCredentialValidationJobs: processPendingCredentialValidationJobsMock,
}))
vi.mock('@/lib/services/integrations', () => ({
  performCredentialValidationAttempt: performCredentialValidationAttemptMock,
}))

import { GET } from '@/app/api/cron/credential-validations/route'

describe('credential validations cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'test-cron-only-secret')
    processPendingCredentialValidationJobsMock.mockResolvedValue({ claimed: 0, completed: 0, pending: 0, failed: 0 })
  })

  it('rifiuta cron senza bearer valido e non avvia job', async () => {
    const response = await GET(new Request('http://localhost/api/cron/credential-validations'))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(response.headers.get('X-Request-Id')).toBe(payload.requestId)
    expect(payload).toMatchObject({ ok: false, error: { code: 'CRON_UNAUTHORIZED' }, requestId: expect.any(String) })
    expect(processPendingCredentialValidationJobsMock).not.toHaveBeenCalled()
    expect(JSON.stringify(payload)).not.toContain('test-cron-only-secret')
  })

  it('segnala la secret non configurata senza avviare il worker', async () => {
    delete process.env.CRON_SECRET

    const response = await GET(new Request('http://localhost/api/cron/credential-validations'))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('X-Request-Id')).toBe(payload.requestId)
    expect(payload).toMatchObject({ ok: false, error: { code: 'CRON_MISCONFIGURED' } })
    expect(processPendingCredentialValidationJobsMock).not.toHaveBeenCalled()
  })

  it('passa il provider single-attempt al worker e restituisce solo un riepilogo', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const response = await GET(new Request('http://localhost/api/cron/credential-validations', {
      headers: { authorization: 'Bearer test-cron-only-secret', 'x-request-id': requestId },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe(requestId)
    expect(processPendingCredentialValidationJobsMock).toHaveBeenCalledWith({
      attemptProvider: performCredentialValidationAttemptMock,
    })
    expect(await response.json()).toEqual({
      ok: true,
      data: { claimed: 0, completed: 0, pending: 0, failed: 0 },
      requestId,
    })
  })

  it('usa error envelope sanitizzato se il worker fallisce', async () => {
    processPendingCredentialValidationJobsMock.mockRejectedValueOnce(new Error('private validation details'))

    const response = await GET(new Request('http://localhost/api/cron/credential-validations', {
      headers: { authorization: 'Bearer test-cron-only-secret' },
    }))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('X-Request-Id')).toBe(payload.requestId)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Errore interno' } })
    expect(JSON.stringify(payload)).not.toContain('private validation details')
  })
})
