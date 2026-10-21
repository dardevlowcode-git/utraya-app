/* Commento didattico:
 * Scopo del file: verifica che i filtri utente e analisi precedano la paginazione dei video.
 * Moduli richiamati: service `videos`, query Supabase sintetiche e `vitest`.
 * Flusso: simula più righe candidate e controlla pagina e totale dopo tutti i filtri.
 */

import { describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase/types'

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@/lib/services/integrations', () => ({
  getProviderApiKeyForUser: vi.fn(),
  getProviderApiKeyForUserAsAdmin: vi.fn(),
}))

import { getVideosForUser } from '@/lib/services/videos'

type TestFilter = { kind: 'eq' | 'in' | 'not'; column: string; value: unknown }
type QueryResponse = { data: unknown[] | null; count?: number; error: null }
interface TestQuery extends PromiseLike<QueryResponse> {
  select(columns: string, options?: { count?: string }): TestQuery
  eq(column: string, value: unknown): TestQuery
  in(column: string, values: unknown[]): TestQuery
  not(column: string, operator: string, value: unknown): TestQuery
  order(column: string, options: { ascending: boolean }): TestQuery
  range(from: number, to: number): TestQuery
}

function createVideo(id: string, publishedAt: string, analysisStatus: string) {
  const channel = {
    id: 'channel-1', youtube_channel_id: 'UC1', handle: null, title: 'Canale',
    description: null, thumbnail_url: null, subscriber_count: null, video_count: null,
    custom_url: null, youtube_metadata: null, status: 'active', created_at: publishedAt, updated_at: publishedAt,
  }
  return {
    id,
    channel_id: 'channel-1',
    youtube_video_id: `youtube-${id}`,
    title: `Titolo ${id}`,
    description: null,
    thumbnail_url: null,
    published_at: publishedAt,
    duration_seconds: null,
    video_url: `https://www.youtube.com/watch?v=${id}`,
    video_type: 'standard',
    availability_status: 'available',
    youtube_metadata: null,
    created_at: publishedAt,
    updated_at: publishedAt,
    channels: channel,
    video_analysis: [{
      id: `analysis-${id}`, analysis_status: analysisStatus, model_used: null, analyzed_at: null,
      analyzed_by_user_id: null, error_message: null, created_at: publishedAt,
      prompt_profile_id: null, video_id: id,
    }],
    video_localized_content: [],
  }
}

function createSupabaseMock() {
  const rows = [
    createVideo('v1', '2026-06-06T00:00:00.000Z', 'completed'),
    createVideo('v2', '2026-06-04T00:00:00.000Z', 'completed'),
    createVideo('v3', '2026-06-03T00:00:00.000Z', 'pending'),
    createVideo('v4', '2026-06-02T00:00:00.000Z', 'completed'),
    createVideo('v5', '2026-06-05T00:00:00.000Z', 'completed'),
  ]
  const states = [
    { video_id: 'v1', seen_status: 'seen', seen_at: '2026-06-01T00:00:00.000Z', hidden_at: null },
    { video_id: 'v4', seen_status: 'hidden', seen_at: null, hidden_at: '2026-06-01T00:00:00.000Z' },
  ]
  const watchlistVideoIds = ['v1', 'v2', 'v3', 'v5']
  const filterColumnsAtRange: string[][] = []

  function resolveQuery(table: string, selection: string, filters: TestFilter[], range: [number, number] | null, order: { column: string; ascending: boolean } | null): QueryResponse {
    if (table === 'user_channels') return { data: [{ channel_id: 'channel-1' }], error: null }
    if (table === 'user_video_states' && selection === 'video_id, seen_status') {
      return { data: states.map(({ video_id, seen_status }) => ({ video_id, seen_status })), error: null }
    }
    if (table === 'user_video_states') {
      const ids = new Set(filters.find((filter) => filter.kind === 'in' && filter.column === 'video_id')?.value as string[] ?? [])
      return { data: states.filter((state) => ids.has(state.video_id)), error: null }
    }
    if (table === 'watchlist_items' && selection.includes('is_default')) {
      const ids = new Set(filters.find((filter) => filter.kind === 'in' && filter.column === 'video_id')?.value as string[] ?? [])
      return { data: watchlistVideoIds.filter((id) => ids.has(id)).map((video_id) => ({ video_id })), error: null }
    }
    if (table === 'watchlist_items') {
      return { data: watchlistVideoIds.map((video_id) => ({ video_id })), error: null }
    }
    if (table !== 'videos') return { data: [], error: null }

    let filtered = rows.filter((row) => filters.every((filter) => {
      if (filter.kind === 'eq' && filter.column === 'channel_id') return row.channel_id === filter.value
      if (filter.kind === 'eq' && filter.column === 'availability_status') return row.availability_status === filter.value
      if (filter.kind === 'eq' && filter.column === 'video_type') return row.video_type === filter.value
      if (filter.kind === 'eq' && filter.column === 'video_analysis.analysis_status') {
        return row.video_analysis[0].analysis_status === filter.value
      }
      if (filter.kind === 'in' && filter.column === 'channel_id') return (filter.value as string[]).includes(row.channel_id)
      if (filter.kind === 'in' && filter.column === 'id') return (filter.value as string[]).includes(row.id)
      if (filter.kind === 'not' && filter.column === 'id') {
        const excludedIds = String(filter.value).slice(1, -1).split(',')
        return !excludedIds.includes(row.id)
      }
      return true
    }))
    if (order) filtered = filtered.sort((left, right) => {
      const difference = left.published_at.localeCompare(right.published_at)
      return order.ascending ? difference : -difference
    })
    const count = filtered.length
    const pageRows = range ? filtered.slice(range[0], range[1] + 1) : filtered
    return { data: pageRows, count, error: null }
  }

  const supabase = {
    from(table: string) {
      let selection = ''
      const filters: TestFilter[] = []
      let range: [number, number] | null = null
      let order: { column: string; ascending: boolean } | null = null
      let rangeFilterColumns: string[] = []
      const query: TestQuery = {
        select(columns) { selection = columns; return query },
        eq(column, value) { filters.push({ kind: 'eq', column, value }); return query },
        in(column, value) { filters.push({ kind: 'in', column, value }); return query },
        not(column, _operator, value) { filters.push({ kind: 'not', column, value }); return query },
        order(column, options) { order = { column, ascending: options.ascending }; return query },
        range(from, to) {
          range = [from, to]
          rangeFilterColumns = filters.map((filter) => filter.column)
          if (table === 'videos') filterColumnsAtRange.push(rangeFilterColumns)
          return query
        },
        then(onfulfilled, onrejected) {
          return Promise.resolve(resolveQuery(table, selection, filters, range, order)).then(onfulfilled, onrejected)
        },
      }
      return query
    },
  }

  return { supabase: supabase as unknown as AppSupabaseClient, filterColumnsAtRange }
}

describe('getVideosForUser pagination', () => {
  it('calcola pagina e totale dopo i filtri watchlist, seenStatus e analysisStatus', async () => {
    const { supabase, filterColumnsAtRange } = createSupabaseMock()

    const result = await getVideosForUser({
      userId: 'user-1',
      onlyWatchlist: true,
      seenStatus: 'unseen',
      analysisStatus: 'completed',
      limit: 1,
      page: 2,
      supabase,
    })

    expect(filterColumnsAtRange[0]).toContain('video_analysis.analysis_status')
    expect(filterColumnsAtRange[0]).toContain('id')
    expect(result).toMatchObject({ page: 2, limit: 1, total: 2 })
    expect(result.items.map((item) => item.video.id)).toEqual(['v2'])
    expect(result.items[0].userState).toMatchObject({ seenStatus: 'unseen', isInWatchlist: true })
  })
})
