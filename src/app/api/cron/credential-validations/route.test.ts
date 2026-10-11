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

    expect(response.status).toBe(401)
    expect(processPendingCredentialValidationJobsMock).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain('test-cron-only-secret')
  })

  it('passa il provider single-attempt al worker e restituisce solo un riepilogo', async () => {
    const response = await GET(new Request('http://localhost/api/cron/credential-validations', {
      headers: { authorization: 'Bearer test-cron-only-secret' },
    }))

    expect(response.status).toBe(200)
    expect(processPendingCredentialValidationJobsMock).toHaveBeenCalledWith({
      attemptProvider: performCredentialValidationAttemptMock,
    })
    expect(await response.json()).toMatchObject({
      success: true,
      data: { claimed: 0, completed: 0, pending: 0, failed: 0 },
    })
  })
})
