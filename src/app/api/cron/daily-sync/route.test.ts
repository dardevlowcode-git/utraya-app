/* Commento didattico:
 * Scopo del file: verifica il comportamento HTTP della route cron giornaliera.
 * Moduli richiamati: `vitest`, `@/lib/services/daily-sync`
 * Flusso: mocka il service, invoca la route e valida status code/payload.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const runDailyChannelSyncMock = vi.fn()

vi.mock('@/lib/services/daily-sync', () => ({
  runDailyChannelSync: runDailyChannelSyncMock,
}))

let GET: typeof import('@/app/api/cron/daily-sync/route').GET

describe('GET /api/cron/daily-sync', () => {
  beforeAll(async () => {
    ;({ GET } = await import('@/app/api/cron/daily-sync/route'))
  })

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 401 when Authorization header is missing or invalid', async () => {
    const response = await GET(new Request('http://localhost/api/cron/daily-sync'))

    expect(response.status).toBe(401)
  })

  it('returns success payload when service completes', async () => {
    runDailyChannelSyncMock.mockResolvedValueOnce({
      success: true,
      runId: 'daily-sync-1',
      startedAt: '2026-04-30T03:00:00.000Z',
      endedAt: '2026-04-30T03:00:10.000Z',
      durationMs: 10000,
      lockAcquired: true,
      lockSkipped: false,
      candidates: 3,
      selectedChannels: 3,
      attemptedChannels: 3,
      queuedJobs: 2,
      deduplicatedJobs: 1,
      skippedNoEligibleUser: 0,
      skippedByLimit: 0,
      timedOut: false,
      failedChannels: 0,
      failures: [],
    })

    const response = await GET(new Request('http://localhost/api/cron/daily-sync', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-secret',
      },
    }))

    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.success).toBe(true)
    expect(payload.data.runId).toBe('daily-sync-1')
  })
})
