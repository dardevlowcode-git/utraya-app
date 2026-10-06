/* Commento didattico:
 * Scopo: registra chiamate API personali e prepara il riepilogo privato del pannello utilizzo.
 * Moduli richiamati: `@/lib/supabase/admin`, `@/lib/supabase/server`, `@/lib/types/database`.
 * Flusso: i service upstream scrivono solo metadati allowlistati; il pannello legge sotto RLS dell'utente.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ApiUsageEventRow } from '@/lib/types/domain'
import type { Database } from '@/lib/types/database'
import type { AppSupabaseClient } from '@/lib/supabase/types'

export const API_USAGE_WINDOW_DAYS = 30
export const GEMINI_INPUT_RATE_USD_PER_MILLION = 0.3
export const GEMINI_OUTPUT_RATE_USD_PER_MILLION = 2.5
export const API_USAGE_PAGE_SIZE = 25

export type ApiUsageProvider = 'youtube' | 'gemini'
export type ApiUsageOutcome = 'success' | 'http_error' | 'network_error' | 'timeout'

export interface RecordApiUsageInput {
  userId: string
  provider: ApiUsageProvider
  operation: string
  outcome: ApiUsageOutcome
  httpStatus?: number | null
  errorCategory?: 'provider_error' | 'network_error' | 'timeout' | 'unknown' | null
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  quotaUnits?: number | null
  quotaBucket?: 'default' | 'search' | null
  occurredAt?: string
}

export function getYouTubeQuotaEstimate(operation: string): { units: number; bucket: 'default' | 'search' } {
  // Gli endpoint read correnti dell'app costano 1 unità per richiesta secondo Google.
  const knownReadMethods = new Set([
    'channels.list',
    'playlistItems.list',
    'videos.list',
    'search.list',
  ])
  if (!knownReadMethods.has(operation)) {
    return { units: 1, bucket: 'default' }
  }
  return { units: 1, bucket: operation === 'search.list' ? 'search' : 'default' }
}

export function estimateGeminiCostUsd(inputTokens: number, outputTokens: number): number {
  const raw = (inputTokens * GEMINI_INPUT_RATE_USD_PER_MILLION
    + outputTokens * GEMINI_OUTPUT_RATE_USD_PER_MILLION) / 1_000_000
  return Number(raw.toFixed(9))
}

export function buildApiUsageEventInsert(input: RecordApiUsageInput): Database['public']['Tables']['api_usage_events']['Insert'] {
  const isGemini = input.provider === 'gemini'
  const inputTokens = isGemini ? input.inputTokens ?? null : null
  const outputTokens = isGemini ? input.outputTokens ?? null : null
  const hasTokenUsage = isGemini && inputTokens !== null && outputTokens !== null
  const quota = input.provider === 'youtube'
    ? input.quotaUnits === undefined || input.quotaUnits === null
      ? getYouTubeQuotaEstimate(input.operation)
      : { units: input.quotaUnits, bucket: input.quotaBucket ?? 'default' }
    : null

  return {
    user_id: input.userId,
    provider: input.provider,
    operation: input.operation,
    occurred_at: input.occurredAt,
    outcome: input.outcome,
    http_status: input.httpStatus ?? null,
    error_category: input.errorCategory ?? null,
    model: isGemini ? input.model ?? null : null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: hasTokenUsage ? inputTokens + outputTokens : null,
    estimated_cost_usd: hasTokenUsage ? estimateGeminiCostUsd(inputTokens, outputTokens) : null,
    input_rate_usd_per_million: hasTokenUsage ? GEMINI_INPUT_RATE_USD_PER_MILLION : null,
    output_rate_usd_per_million: hasTokenUsage ? GEMINI_OUTPUT_RATE_USD_PER_MILLION : null,
    quota_units: quota?.units ?? null,
    quota_bucket: quota?.bucket ?? null,
  }
}

export interface FetchAndRecordInput extends Omit<RecordApiUsageInput, 'outcome' | 'httpStatus' | 'errorCategory'> {
  url: string
  init?: RequestInit
  fetcher?: typeof fetch
}

/** Esegue una singola richiesta provider e registra l'esito senza serializzare URL o payload. */
export async function fetchAndRecordProviderRequest(input: FetchAndRecordInput): Promise<Response> {
  const { url, init, fetcher = fetch, ...usageInput } = input
  try {
    const response = await fetcher(url, init)
    await recordApiUsageEvent({
      ...usageInput,
      outcome: response.ok ? 'success' : 'http_error',
      httpStatus: response.status,
      errorCategory: response.ok ? null : 'provider_error',
    })
    return response
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    await recordApiUsageEvent({
      ...usageInput,
      outcome: timedOut ? 'timeout' : 'network_error',
      errorCategory: timedOut ? 'timeout' : 'network_error',
    })
    throw error
  }
}

export async function recordGeminiUsage(params: {
  userId: string
  operation: string
  model: string
  outcome: ApiUsageOutcome
  httpStatus?: number | null
  errorCategory?: 'provider_error' | 'network_error' | 'timeout' | 'unknown' | null
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}): Promise<boolean> {
  return recordApiUsageEvent({
    userId: params.userId,
    provider: 'gemini',
    operation: params.operation,
    model: params.model,
    outcome: params.outcome,
    httpStatus: params.httpStatus,
    errorCategory: params.errorCategory,
    inputTokens: params.usageMetadata?.promptTokenCount,
    outputTokens: params.usageMetadata?.candidatesTokenCount,
  })
}

/**
 * Inserisce un evento in modo append-only. Un problema nel registro non deve
 * trasformare una risposta upstream valida in errore applicativo; il log
 * server-side segnala il guasto senza includere dati o credenziali.
 */
export async function recordApiUsageEvent(
  input: RecordApiUsageInput,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  try {
    const row = buildApiUsageEventInsert(input)
    const client = adminClient ?? createAdminClient()
    const { error } = await client.from('api_usage_events').insert(row)
    if (!error) return true
  } catch {
    // Il dettaglio DB/eccezione non viene incluso nei log applicativi.
  }
  console.error('API usage event could not be persisted')
  return false
}

export async function cleanupExpiredApiUsageEvents(
  now = new Date(),
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<number> {
  const client = adminClient ?? createAdminClient()
  const cutoff = new Date(now.getTime() - API_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await client
    .from('api_usage_events')
    .delete({ count: 'exact' })
    .lt('occurred_at', cutoff)
  if (error) throw new Error('Impossibile eliminare gli eventi API scaduti')
  return count ?? 0
}

export interface ApiUsageSummary {
  provider: ApiUsageProvider
  requestCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  quotaUnits: number
}

export interface ApiUsageDashboard {
  since: string
  page: number
  pageSize: number
  totalEvents: number
  totalPages: number
  summaries: ApiUsageSummary[]
  events: ApiUsageEventRow[]
}

const EMPTY_SUMMARY = (provider: ApiUsageProvider): ApiUsageSummary => ({
  provider,
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
  quotaUnits: 0,
})

export async function getApiUsageDashboard(
  userId: string,
  requestedPage = 1,
  client?: AppSupabaseClient,
  now = new Date()
): Promise<ApiUsageDashboard> {
  const supabase = client ?? await createClient()
  const since = new Date(now.getTime() - API_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: summaryRows, error: summaryError } = await supabase.rpc('get_my_api_usage_summary', { p_since: since })
  if (summaryError) {
    throw new Error('Impossibile caricare il riepilogo di utilizzo API')
  }

  const summaries = new Map<ApiUsageProvider, ApiUsageSummary>([
    ['gemini', EMPTY_SUMMARY('gemini')],
    ['youtube', EMPTY_SUMMARY('youtube')],
  ])
  for (const row of summaryRows ?? []) {
    const provider = row.provider as ApiUsageProvider
    if (provider !== 'gemini' && provider !== 'youtube') continue
    summaries.set(provider, {
      provider,
      requestCount: Number(row.request_count),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      estimatedCostUsd: Number(row.estimated_cost_usd),
      quotaUnits: Number(row.quota_units),
    })
  }

  const totalEvents = Array.from(summaries.values()).reduce((sum, summary) => sum + summary.requestCount, 0)
  const totalPages = Math.max(1, Math.ceil(totalEvents / API_USAGE_PAGE_SIZE))
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages)
  const start = (page - 1) * API_USAGE_PAGE_SIZE
  const { data: eventRows, error: eventsError } = await supabase
    .from('api_usage_events')
    .select('id, user_id, provider, operation, occurred_at, outcome, http_status, error_category, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, input_rate_usd_per_million, output_rate_usd_per_million, quota_units, quota_bucket')
    .eq('user_id', userId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + API_USAGE_PAGE_SIZE - 1)

  if (eventsError) {
    throw new Error('Impossibile caricare il riepilogo di utilizzo API')
  }

  return {
    since,
    page,
    pageSize: API_USAGE_PAGE_SIZE,
    totalEvents,
    totalPages,
    summaries: [summaries.get('gemini')!, summaries.get('youtube')!],
    events: (eventRows ?? []) as ApiUsageEventRow[],
  }
}
