/* Commento didattico:
 * Scopo: verifica i dati osservabili del registro utilizzo API e i calcoli mostrati all'utente.
 * Moduli richiamati: `vitest`, `./api-usage`.
 * Flusso: usa tariffe e costi quota fissati nella spec per controllare insert allowlistati.
 */

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase/types'

const { createAdminClientMock, insertMock, fromMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  insertMock: vi.fn(),
  fromMock: vi.fn(),
}))

const apiUsageMigration = readFileSync(
  new URL('../../../supabase/migrations/20261004120000_api_usage_events.sql', import.meta.url),
  'utf8'
)
const apiUsageSummaryMigration = readFileSync(
  new URL('../../../supabase/migrations/20261006213338_api_usage_summary_quality.sql', import.meta.url),
  'utf8'
)

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import {
  buildApiUsageEventInsert,
  cleanupExpiredApiUsageEvents,
  estimateGeminiCostUsd,
  fetchAndRecordProviderRequest,
  getApiUsageDashboard,
  getYouTubeQuotaEstimate,
  recordGeminiUsage,
} from '@/lib/services/api-usage'

describe('api usage accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertMock.mockResolvedValue({ error: null })
    fromMock.mockReturnValue({ insert: insertMock })
    createAdminClientMock.mockReturnValue({ from: fromMock })
  })

  it('calcola costo Gemini dalle tariffe approvate mantenendo precisione sotto il centesimo', () => {
    expect(estimateGeminiCostUsd(50_768, 149)).toBe(0.0156029)
  })

  it('registra i token e congela le tariffe usate per ricostruire la stima', () => {
    expect(buildApiUsageEventInsert({
      userId: 'owner-1',
      provider: 'gemini',
      operation: 'generateContent',
      model: 'gemini-3.5-flash-lite',
      outcome: 'success',
      httpStatus: 200,
      inputTokens: 50_768,
      outputTokens: 149,
      totalTokens: 50_918,
    })).toMatchObject({
      user_id: 'owner-1',
      provider: 'gemini',
      input_tokens: 50_768,
      output_tokens: 149,
      total_tokens: 50_918,
      estimated_cost_usd: 0.0156029,
      input_rate_usd_per_million: 0.3,
      output_rate_usd_per_million: 2.5,
    })
  })

  it('adatta i token effettivi restituiti da Gemini al registro privato', async () => {
    await recordGeminiUsage({
      userId: 'credential-owner',
      operation: 'generateContent',
      model: 'gemini-3.5-flash-lite',
      outcome: 'success',
      httpStatus: 200,
      usageMetadata: { promptTokenCount: 50_768, candidatesTokenCount: 149, totalTokenCount: 50_918 },
    })

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'credential-owner',
      input_tokens: 50_768,
      output_tokens: 149,
      total_tokens: 50_918,
      estimated_cost_usd: 0.0156029,
    }))
  })

  it('non deduce il totale Gemini dalla somma input/output se il provider non lo restituisce', () => {
    expect(buildApiUsageEventInsert({
      userId: 'owner-1',
      provider: 'gemini',
      operation: 'generateContent',
      outcome: 'success',
      inputTokens: 8,
      outputTokens: 3,
    })).toMatchObject({
      input_tokens: 8,
      output_tokens: 3,
      total_tokens: null,
    })
  })

  it('non inventa token/costi Gemini quando il provider non fornisce usage metadata', () => {
    expect(buildApiUsageEventInsert({
      userId: 'owner-1',
      provider: 'gemini',
      operation: 'generateContent',
      outcome: 'http_error',
      httpStatus: 429,
      errorCategory: 'provider_error',
    })).toMatchObject({
      outcome: 'http_error',
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      estimated_cost_usd: null,
    })
  })

  it('conteggia ogni richiesta YouTube, compresi gli errori, nel bucket endpoint corretto', () => {
    expect(getYouTubeQuotaEstimate('search.list')).toEqual({ units: 1, bucket: 'search' })
    expect(['channels.list', 'playlistItems.list', 'videos.list'].map(getYouTubeQuotaEstimate)).toEqual([
      { units: 1, bucket: 'default' },
      { units: 1, bucket: 'default' },
      { units: 1, bucket: 'default' },
    ])
    expect(buildApiUsageEventInsert({
      userId: 'owner-1',
      provider: 'youtube',
      operation: 'videos.list',
      outcome: 'http_error',
      httpStatus: 403,
    })).toMatchObject({
      provider: 'youtube',
      quota_units: 1,
      quota_bucket: 'default',
      estimated_cost_usd: null,
      input_tokens: null,
    })
  })

  it('non persiste mai valori arbitrarî di errore o payload API', () => {
    const insert = buildApiUsageEventInsert({
      userId: 'owner-1',
      provider: 'youtube',
      operation: 'channels.list',
      outcome: 'network_error',
      errorCategory: 'network_error',
    })

    expect(insert).not.toHaveProperty('url')
    expect(insert).not.toHaveProperty('requestBody')
    expect(insert).not.toHaveProperty('responseBody')
    expect(insert).not.toHaveProperty('apiKey')
    expect(insert.error_category).toBe('network_error')
  })

  it('registra una richiesta YouTube effettiva senza salvare la URL contenente la chiave', async () => {
    const response = await fetchAndRecordProviderRequest({
      userId: 'credential-owner',
      provider: 'youtube',
      operation: 'channels.list',
      url: 'https://www.googleapis.com/youtube/v3/channels?key=do-not-store-this',
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    })

    expect(response.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('api_usage_events')
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'credential-owner',
      provider: 'youtube',
      operation: 'channels.list',
      outcome: 'success',
      http_status: 200,
      quota_units: 1,
    }))
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain('do-not-store-this')
  })

  it('registra anche la chiamata che termina per rete/timeout senza interrompere il propagarsi dell’errore', async () => {
    const timeout = Object.assign(new Error('private transport detail'), { name: 'TimeoutError' })
    const fetcher = vi.fn().mockRejectedValue(timeout)

    await expect(fetchAndRecordProviderRequest({
      userId: 'credential-owner',
      provider: 'youtube',
      operation: 'playlistItems.list',
      url: 'https://www.googleapis.com/youtube/v3/playlistItems?key=secret',
      fetcher,
    })).rejects.toBe(timeout)

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'credential-owner',
      outcome: 'timeout',
      error_category: 'timeout',
      quota_units: 1,
    }))
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain('secret')
  })

  it('classifica un errore di rete non-timeout senza persistere il messaggio upstream', async () => {
    const networkError = new Error('private transport detail')

    await expect(fetchAndRecordProviderRequest({
      userId: 'credential-owner',
      provider: 'youtube',
      operation: 'channels.list',
      url: 'https://www.googleapis.com/youtube/v3/channels?key=not-persisted',
      fetcher: vi.fn().mockRejectedValue(networkError),
    })).rejects.toBe(networkError)

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'credential-owner',
      outcome: 'network_error',
      error_category: 'network_error',
      quota_units: 1,
    }))
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain('private transport detail')
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain('not-persisted')
  })

  it('conserva un evento distinto per ogni tentativo, incluso il retry dopo un errore HTTP', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await fetchAndRecordProviderRequest({
        userId: 'credential-owner',
        provider: 'youtube',
        operation: 'videos.list',
        url: 'https://www.googleapis.com/youtube/v3/videos?key=not-persisted',
        fetcher,
      })
    }

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fromMock.mock.calls).toEqual([
      ['api_usage_events'],
      ['api_usage_events'],
    ])
    expect(insertMock.mock.calls.map(([event]) => event)).toMatchObject([
      { user_id: 'credential-owner', outcome: 'http_error', http_status: 503, quota_units: 1 },
      { user_id: 'credential-owner', outcome: 'success', http_status: 200, quota_units: 1 },
    ])
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain('not-persisted')
  })

  it('mantiene la risposta upstream quando la scrittura del ledger fallisce senza loggare dettagli DB', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    insertMock.mockResolvedValue({ error: { message: 'private database response' } })

    try {
      const response = await fetchAndRecordProviderRequest({
        userId: 'credential-owner',
        provider: 'youtube',
        operation: 'videos.list',
        url: 'https://www.googleapis.com/youtube/v3/videos?key=not-persisted',
        fetcher: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
      })

      expect(response.status).toBe(200)
      expect(insertMock).toHaveBeenCalledOnce()
      expect(errorSpy).toHaveBeenCalledWith('API usage event could not be persisted')
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private database response')
      expect(JSON.stringify(insertMock.mock.calls)).not.toContain('not-persisted')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('mantiene in RLS solo gli eventi dell’account autenticato e nella retention prevista', () => {
    const policy = apiUsageMigration.match(
      /CREATE POLICY "API usage: read own" ON public\.api_usage_events\s+FOR SELECT USING \(([\s\S]*?)\);/
    )?.[1]

    expect(policy).toBeDefined()
    expect(policy).toMatch(/user_id\s*=\s*auth\.uid\(\)/)
    expect(policy).toMatch(/occurred_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL\s*'30 days'/)
  })

  it('aggiorna la RPC senza trasformare somme sconosciute in zero', () => {
    expect(apiUsageSummaryMigration).toMatch(/DROP FUNCTION IF EXISTS public\.get_my_api_usage_summary\(TIMESTAMPTZ\)/)
    expect(apiUsageSummaryMigration).toMatch(/unknown_usage_count/)
    expect(apiUsageSummaryMigration).toMatch(/usage\.total_tokens IS NULL/)
    expect(apiUsageSummaryMigration).not.toMatch(/COALESCE\(SUM\(usage\.(input_tokens|output_tokens|total_tokens|estimated_cost_usd|quota_units)\)/)
  })

  it('applica il cutoff della retention di 30 giorni nel cleanup schedulato', async () => {
    const ltMock = vi.fn().mockResolvedValue({ count: 3, error: null })
    const deleteMock = vi.fn().mockReturnValue({ lt: ltMock })
    const adminClient = { from: vi.fn().mockReturnValue({ delete: deleteMock }) } as never

    await expect(cleanupExpiredApiUsageEvents(new Date('2026-10-04T00:00:00.000Z'), adminClient)).resolves.toBe(3)

    expect(ltMock).toHaveBeenCalledWith('occurred_at', '2026-09-04T00:00:00.000Z')
  })

  it('non propaga dettagli DB se il cleanup rifiuta la cancellazione', async () => {
    const ltMock = vi.fn().mockResolvedValue({ count: null, error: { message: 'private database response' } })
    const adminClient = {
      from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue({ lt: ltMock }) }),
    } as never

    await expect(cleanupExpiredApiUsageEvents(new Date('2026-10-04T00:00:00.000Z'), adminClient))
      .rejects.toThrow('Impossibile eliminare gli eventi API scaduti')
  })

  it('mostra solo l’owner, delimita 30 giorni e corregge la pagina rispetto ai dati aggregati', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.gte.mockReturnValue(query)
    query.order.mockReturnValue(query)
    const clientObject = {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({
        data: [{
          provider: 'youtube',
          request_count: 30,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          quota_units: 30,
          unknown_usage_count: 0,
        }],
        error: null,
      }),
    }
    const client = clientObject as unknown as AppSupabaseClient

    const dashboard = await getApiUsageDashboard(
      'credential-owner',
      99,
      client,
      new Date('2026-10-04T00:00:00.000Z')
    )

    expect(dashboard).toMatchObject({
      since: '2026-09-04T00:00:00.000Z',
      page: 2,
      totalEvents: 30,
      totalPages: 2,
    })
    expect(query.eq).toHaveBeenCalledWith('user_id', 'credential-owner')
    expect(query.gte).toHaveBeenCalledWith('occurred_at', '2026-09-04T00:00:00.000Z')
    expect(query.range).toHaveBeenCalledWith(25, 49)
    expect(clientObject.rpc).toHaveBeenCalledWith('get_my_api_usage_summary', { p_since: '2026-09-04T00:00:00.000Z' })
  })

  it('mantiene ignoti gli aggregati Gemini quando tutti gli eventi registrati non hanno usage', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.gte.mockReturnValue(query)
    query.order.mockReturnValue(query)
    const client = {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({
        data: [{
          provider: 'gemini',
          request_count: 2,
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null,
          quota_units: 0,
          unknown_usage_count: 2,
        }],
        error: null,
      }),
    } as unknown as AppSupabaseClient

    const dashboard = await getApiUsageDashboard(
      'credential-owner',
      1,
      client,
      new Date('2026-10-04T00:00:00.000Z')
    )

    expect(dashboard.summaries[0]).toMatchObject({
      provider: 'gemini',
      requestCount: 2,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      unknownUsageCount: 2,
      usageQuality: 'unknown',
    })
  })

  it('marca parziali le somme Gemini quando alcuni eventi registrati non hanno metadati completi', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.gte.mockReturnValue(query)
    query.order.mockReturnValue(query)
    const client = {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({
        data: [{
          provider: 'gemini',
          request_count: 2,
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 123,
          estimated_cost_usd: 0.00008,
          quota_units: 0,
          unknown_usage_count: 1,
        }],
        error: null,
      }),
    } as unknown as AppSupabaseClient

    const dashboard = await getApiUsageDashboard(
      'credential-owner',
      1,
      client,
      new Date('2026-10-04T00:00:00.000Z')
    )

    expect(dashboard.summaries[0]).toMatchObject({
      requestCount: 2,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 123,
      estimatedCostUsd: 0.00008,
      unknownUsageCount: 1,
      usageQuality: 'partial',
    })
  })
})
