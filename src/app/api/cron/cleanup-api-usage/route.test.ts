/* Commento didattico:
 * Scopo: verifica autenticazione e comportamento osservabile del cron di retention eventi API.
 * Moduli richiamati: route handler, `api-usage` mocked e `vitest`.
 * Flusso: una chiamata senza secret valida non pulisce; il Bearer corretto invoca il cleanup una sola volta.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanupMock } = vi.hoisted(() => ({ cleanupMock: vi.fn() }))

vi.mock('@/lib/services/api-usage', () => ({ cleanupExpiredApiUsageEvents: cleanupMock }))

import { GET } from '@/app/api/cron/cleanup-api-usage/route'

describe('GET /api/cron/cleanup-api-usage', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    cleanupMock.mockResolvedValue(4)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it('rifiuta una richiesta senza bearer prima di accedere al cleanup', async () => {
    const response = await GET(new Request('https://dev.utraya.com/api/cron/cleanup-api-usage'))

    expect(response.status).toBe(401)
    expect(cleanupMock).not.toHaveBeenCalled()
  })

  it('rifiuta un bearer errato prima di accedere al cleanup', async () => {
    const response = await GET(new Request('https://dev.utraya.com/api/cron/cleanup-api-usage', {
      headers: { authorization: 'Bearer invalid-cron-secret' },
    }))

    expect(response.status).toBe(401)
    expect(cleanupMock).not.toHaveBeenCalled()
  })

  it('segnala la configurazione mancante senza invocare il cleanup', async () => {
    delete process.env.CRON_SECRET

    const response = await GET(new Request('https://dev.utraya.com/api/cron/cleanup-api-usage', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'CRON_MISCONFIGURED' } })
    expect(cleanupMock).not.toHaveBeenCalled()
  })

  it('pulisce con il bearer cron e restituisce solo il conteggio', async () => {
    const response = await GET(new Request('https://dev.utraya.com/api/cron/cleanup-api-usage', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { deletedCount: 4 }, requestId: expect.any(String) })
    expect(cleanupMock).toHaveBeenCalledOnce()
  })

  it('restituisce un errore sanitizzato se la pulizia fallisce', async () => {
    cleanupMock.mockRejectedValue(new Error('private cleanup detail'))

    const response = await GET(new Request('https://dev.utraya.com/api/cron/cleanup-api-usage', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }))
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).toContain('API_USAGE_CLEANUP_FAILED')
    expect(body).not.toContain('private cleanup detail')
    expect(cleanupMock).toHaveBeenCalledOnce()
  })
})
