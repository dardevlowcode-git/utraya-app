/* Commento didattico:
 * Scopo del file: verifica la route interna di continuazione dei job di trascrizione.
 * Moduli richiamati: `vitest`, route, runner del job mockato.
 * Flusso: controlla CRON_SECRET (assente, errato, corretto), validazione del payload e che after() riceva la Promise del worker.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { runJobMock, afterMock } = vi.hoisted(() => ({ runJobMock: vi.fn(), afterMock: vi.fn() }))

vi.mock('@/lib/services/transcription-requests', () => ({ runTranscriptionJobNow: runJobMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: vi.fn() }))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: afterMock }))

import { POST, maxDuration } from './route'

const JOB = '5f1a3b1e-0000-4000-8000-0000000000aa'

function call(secret: string | null, body: unknown = { jobId: JOB }) {
  return POST(new Request('https://app.test/api/cron/transcription-continue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  }))
}

describe('POST /api/cron/transcription-continue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('usa il massimo di durata Hobby', () => {
    expect(maxDuration).toBe(300)
  })

  it('senza CRON_SECRET configurato risponde 500', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('x')).status).toBe(500)
  })

  it('rifiuta secret mancante o errato (anche di lunghezza diversa)', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('synthetic-cron-secreX')).status).toBe(401)
    expect((await call('corto')).status).toBe(401)
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('valida il payload', async () => {
    expect((await call('synthetic-cron-secret', { jobId: 'non-uuid' })).status).toBe(400)
    expect((await call('synthetic-cron-secret', { jobId: JOB, altro: 1 })).status).toBe(400)
  })

  it('risponde 202 e affida a after() la Promise del worker', async () => {
    const promise = Promise.resolve({ outcome: 'complete', partsSaved: 1 })
    runJobMock.mockReturnValue(promise)
    const response = await call('synthetic-cron-secret')
    expect(response.status).toBe(202)
    expect((afterMock.mock.calls[0][0] as () => unknown)()).toBe(promise)
    expect(runJobMock).toHaveBeenCalledWith(JOB)
  })
})
