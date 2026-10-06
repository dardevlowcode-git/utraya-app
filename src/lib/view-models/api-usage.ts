/* Commento didattico:
 * Scopo: espone shape serializzabili e allowlistate per il pannello utilizzo API.
 * Moduli richiamati: tipi di dominio derivati dallo schema database.
 * Flusso: il service converte le righe Supabase in dati camelCase adatti alla UI.
 */

import type { ApiUsageEventRow } from '@/lib/types/domain'

export type ApiUsageProvider = 'youtube' | 'gemini'

export type ApiUsageEventRowInput = Pick<
  ApiUsageEventRow,
  | 'id'
  | 'provider'
  | 'operation'
  | 'occurred_at'
  | 'outcome'
  | 'http_status'
  | 'error_category'
  | 'model'
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'estimated_cost_usd'
  | 'quota_units'
  | 'quota_bucket'
>

export interface ApiUsageEventViewModel {
  id: string
  provider: ApiUsageProvider
  operation: string
  occurredAt: string
  outcome: ApiUsageEventRow['outcome']
  httpStatus: number | null
  errorCategory: ApiUsageEventRow['error_category']
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
  quotaUnits: number | null
  quotaBucket: ApiUsageEventRow['quota_bucket']
}

export interface ApiUsageSummaryViewModel {
  provider: ApiUsageProvider
  requestCount: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
  quotaUnits: number | null
  unknownUsageCount: number
  usageQuality: 'none' | 'recorded' | 'partial' | 'unknown'
}

export interface ApiUsageDashboardViewModel {
  since: string
  page: number
  pageSize: number
  totalEvents: number
  totalPages: number
  summaries: ApiUsageSummaryViewModel[]
  events: ApiUsageEventViewModel[]
}

/** Converte un evento DB nell’allowlist camelCase consumata dal pannello. */
export function toApiUsageEventViewModel(row: ApiUsageEventRowInput): ApiUsageEventViewModel {
  return {
    id: row.id,
    provider: row.provider,
    operation: row.operation,
    occurredAt: row.occurred_at,
    outcome: row.outcome,
    httpStatus: row.http_status,
    errorCategory: row.error_category,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    quotaUnits: row.quota_units,
    quotaBucket: row.quota_bucket,
  }
}
