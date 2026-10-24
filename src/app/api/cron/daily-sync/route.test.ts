/* Commento didattico:
 * Scopo del file: verifica auth cron, status e sanitizzazione della route daily-sync.
 * Moduli richiamati: handler HTTP, service daily-sync simulato e AppError del progetto.
 * Flusso: esercita rifiuti Bearer, configurazione, successo completo/parziale e risposta d’errore pubblica.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/utils/errors'

const { runDailyChannelSyncMock } = vi.hoisted(() => ({ runDailyChannelSyncMock: vi.fn() }))

vi.mock('@/lib/services/daily-sync', () => ({ runDailyChannelSync: runDailyChannelSyncMock }))

import { GET } from './route'

const SECRET = 'test-daily-sync-secret'

function result(success: boolean) {
  return {
    success,
    runId: 'daily-sync-test-1',
    startedAt: '2026-10-20T03:00:00.000Z',
    endedAt: '2026-10-20T03:00:10.000Z',
    durationMs: 10_000,
    lockAcquired: true,
    lockSkipped: false,
    candidates: 3,
    selectedChannels: 3,
    attemptedChannels: 3,
    queuedJobs: success ? 2 : 1,
    deduplicatedJobs: 1,
    skippedNoEligibleUser: 0,
    skippedByLimit: 0,
    timedOut: false,
    failedChannels: success ? 0 : 1,
    failures: success ? [] : [{ channelId: 'channel-test', message: 'provider unavailable' }],
  }
}

function get(authorization?: string) {
  return GET(new Request('http://localhost/api/cron/daily-sync', {
    headers: authorization === undefined ? {} : { authorization },
  }))
}

describe('GET /api/cron/daily-sync', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('CRON_SECRET', SECRET)
    runDailyChannelSyncMock.mockResolvedValue(result(true))
  })

  afterEach(() => vi.unstubAllEnvs())

  it('rifiuta bearer assente, errato e errato della stessa lunghezza senza avviare il service', async () => {
    expect((await get()).status).toBe(401)
    expect((await get('Bearer wrong')).status).toBe(401)
    expect((await get('Bearer test-daily-sync-secreX')).status).toBe(401)
    expect(runDailyChannelSyncMock).not.toHaveBeenCalled()
  })

  it('risponde 500 se CRON_SECRET non è configurata senza avviare il service', async () => {
    vi.stubEnv('CRON_SECRET', '')

    expect((await get(`Bearer ${SECRET}`)).status).toBe(500)
    expect(runDailyChannelSyncMock).not.toHaveBeenCalled()
  })

  it('restituisce 200 e il riepilogo quando il sync riesce', async () => {
    const response = await get(`Bearer ${SECRET}`)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, data: { runId: 'daily-sync-test-1', failedChannels: 0 } })
    expect(runDailyChannelSyncMock).toHaveBeenCalledOnce()
  })

  it('restituisce 207 e il riepilogo se il sync ha esiti parziali', async () => {
    runDailyChannelSyncMock.mockResolvedValueOnce(result(false))

    const response = await get(`Bearer ${SECRET}`)
    const payload = await response.json()

    expect(response.status).toBe(207)
    expect(payload).toMatchObject({ success: false, data: { runId: 'daily-sync-test-1', failedChannels: 1 } })
    expect(runDailyChannelSyncMock).toHaveBeenCalledOnce()
  })

  it('non espone i dettagli interni se il service fallisce', async () => {
    runDailyChannelSyncMock.mockRejectedValueOnce(new AppError('private database detail', 'temporary', 503))

    const response = await get(`Bearer ${SECRET}`)
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).toContain('Errore interno')
    expect(body).not.toContain('private database detail')
    expect(runDailyChannelSyncMock).toHaveBeenCalledOnce()
  })
})
