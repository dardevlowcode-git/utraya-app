/* Commento didattico:
 * Scopo del file: verifica autorizzazione e riepilogo HTTP del cron di esecuzione cancellazioni.
 * Moduli richiamati: handler cron reale e service account-deletion simulato.
 * Flusso: prova i rifiuti Bearer senza eseguire il job e il successo con secret di test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { processPendingDeletionRequestsMock } = vi.hoisted(() => ({
  processPendingDeletionRequestsMock: vi.fn(),
}))

vi.mock('@/lib/services/account-deletion', () => ({
  processPendingDeletionRequests: processPendingDeletionRequestsMock,
}))

import { GET } from './route'

const SECRET = 'test-secret-daily'

function get(authorization?: string) {
  return GET(new Request('http://localhost/api/cron/daily-deletion-executor', {
    headers: authorization === undefined ? {} : { authorization },
  }))
}

describe('GET /api/cron/daily-deletion-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', SECRET)
    processPendingDeletionRequestsMock.mockResolvedValue({ processed: 3, failed: 1 })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('rifiuta Bearer assente, errato e errato della stessa lunghezza senza esecuzione', async () => {
    expect((await get()).status).toBe(401)
    expect((await get('Bearer incorrect')).status).toBe(401)
    expect((await get('Bearer test-secret-dailX')).status).toBe(401)
    expect(processPendingDeletionRequestsMock).not.toHaveBeenCalled()
  })

  it('risponde 500 se CRON_SECRET non è configurata senza eseguire il job', async () => {
    vi.stubEnv('CRON_SECRET', '')

    expect((await get(`Bearer ${SECRET}`)).status).toBe(500)
    expect(processPendingDeletionRequestsMock).not.toHaveBeenCalled()
  })

  it('esegue il cron autorizzato e restituisce il riepilogo', async () => {
    const response = await get(`Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { processed: 3, failed: 1 } })
    expect(processPendingDeletionRequestsMock).toHaveBeenCalledOnce()
  })
})
