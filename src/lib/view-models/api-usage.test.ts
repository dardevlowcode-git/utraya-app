/* Commento didattico:
 * Scopo: verifica la conversione degli eventi API in dati serializzabili per la UI.
 * Moduli richiamati: view model API usage, tipi database e `vitest`.
 * Flusso: controlla la forma pubblica consentita e l’assenza di campi interni non necessari.
 */

import { describe, expect, it } from 'vitest'
import { toApiUsageEventViewModel } from './api-usage'
import type { ApiUsageEventRow } from '@/lib/types/domain'

describe('API usage view model', () => {
  it('mappa l’evento in camelCase senza owner o campi interni di tariffa', () => {
    const row: ApiUsageEventRow = {
      id: 'event-1',
      user_id: 'owner-1',
      provider: 'gemini',
      operation: 'generateContent',
      occurred_at: '2026-10-05T12:00:00.000Z',
      outcome: 'success',
      http_status: 200,
      error_category: null,
      model: 'gemini-test',
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 16,
      estimated_cost_usd: 0.0001,
      input_rate_usd_per_million: 0.3,
      output_rate_usd_per_million: 2.5,
      quota_units: null,
      quota_bucket: null,
    }

    const view = toApiUsageEventViewModel(row)

    expect(view).toEqual({
      id: 'event-1',
      provider: 'gemini',
      operation: 'generateContent',
      occurredAt: '2026-10-05T12:00:00.000Z',
      outcome: 'success',
      httpStatus: 200,
      errorCategory: null,
      model: 'gemini-test',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 16,
      estimatedCostUsd: 0.0001,
      quotaUnits: null,
      quotaBucket: null,
    })
    expect(view).not.toHaveProperty('user_id')
    expect(view).not.toHaveProperty('input_rate_usd_per_million')
  })
})
