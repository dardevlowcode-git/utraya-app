/* Commento didattico:
 * Scopo del file: fornisce ai test di servizio un fake Supabase piccolo ma fedele ai filtri SQL più usati.
 * Moduli richiamati: tipo condiviso `AppSupabaseClient`.
 * Flusso: le query si compongono in memoria e applicano i filtri alle righe prima di ordinamento, paginazione e conteggio.
 */

import type { AppSupabaseClient } from '@/lib/supabase/types'

export type FilteringRow = Record<string, unknown>

type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'is'; column: string; value: unknown }
  | { kind: 'in'; column: string; value: readonly unknown[] }
  | { kind: 'not'; column: string; operator: string; value: unknown }

type QueryResponse = {
  data: unknown
  error: { message: string } | null
  count: number | null
}

type QueryBuilder = PromiseLike<QueryResponse> & {
  select(columns: string, options?: { count?: string; head?: boolean }): QueryBuilder
  eq(column: string, value: unknown): QueryBuilder
  in(column: string, values: readonly unknown[]): QueryBuilder
  is(column: string, value: unknown): QueryBuilder
  not(column: string, operator: string, value: unknown): QueryBuilder
  order(column: string, options?: { ascending?: boolean }): QueryBuilder
  range(from: number, to: number): QueryBuilder
  maybeSingle(): Promise<QueryResponse>
  single(): Promise<QueryResponse>
  insert(values: FilteringRow | readonly FilteringRow[]): QueryBuilder
  update(values: FilteringRow): QueryBuilder
  delete(): QueryBuilder
  upsert(values: FilteringRow | readonly FilteringRow[], options?: { onConflict?: string }): QueryBuilder
}

type Mutation =
  | { kind: 'insert'; values: readonly FilteringRow[] }
  | { kind: 'upsert'; values: readonly FilteringRow[]; onConflict: string[] }
  | { kind: 'update'; values: FilteringRow }
  | { kind: 'delete' }
  | null

/**
 * Crea righe condivise fra identità e restituisce un client di test che le filtra davvero.
 * A differenza di un fake che registra solo `.eq()`, qui togliere un filtro di ownership cambia
 * i dati osservati: un test d'isolamento può quindi fallire proprio come farebbe con query SQL.
 */
export function createFilteringSupabase(seed: Record<string, readonly FilteringRow[]>): {
  client: AppSupabaseClient
  rows(table: string): FilteringRow[]
} {
  const tables = new Map<string, FilteringRow[]>(
    Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  )
  let generatedId = 0

  function tableRows(table: string): FilteringRow[] {
    const existing = tables.get(table)
    if (existing) return existing
    const created: FilteringRow[] = []
    tables.set(table, created)
    return created
  }

  function valuesAt(value: unknown, path: readonly string[]): unknown[] {
    if (path.length === 0) return Array.isArray(value) ? value.flatMap((item) => valuesAt(item, [])) : [value]
    if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, path))
    if (typeof value !== 'object' || value === null) return [undefined]
    const [segment, ...remaining] = path
    return valuesAt((value as FilteringRow)[segment], remaining)
  }

  function columnValues(table: string, row: FilteringRow, column: string): unknown[] {
    const [relation, ...remaining] = column.split('.')
    // Supabase relation filters such as watchlists.user_id resolve through the foreign key.
    if (table === 'watchlist_items' && relation === 'watchlists') {
      const watchlist = tableRows('watchlists').find((candidate) => candidate.id === row.watchlist_id)
      return valuesAt(watchlist, remaining)
    }
    return valuesAt(row, column.split('.'))
  }

  function matches(table: string, row: FilteringRow, filters: readonly Filter[]): boolean {
    return filters.every((filter) => {
      const values = columnValues(table, row, filter.column)
      if (filter.kind === 'eq' || filter.kind === 'is') {
        return values.some((candidate) => Object.is(candidate, filter.value))
      }
      if (filter.kind === 'in') return values.some((candidate) => filter.value.some((value) => Object.is(value, candidate)))
      if (filter.operator === 'in' && typeof filter.value === 'string') {
        const excluded = filter.value.replace(/^\(|\)$/g, '').split(',')
        return values.every((candidate) => !excluded.includes(String(candidate)))
      }
      return values.every((candidate) => !Object.is(candidate, filter.value))
    })
  }

  function compare(left: unknown, right: unknown): number {
    if (left === right) return 0
    if (left === null || left === undefined) return -1
    if (right === null || right === undefined) return 1
    if (typeof left === 'number' && typeof right === 'number') return left - right
    return String(left).localeCompare(String(right))
  }

  function makeQuery(table: string): QueryBuilder {
    let filters: Filter[] = []
    let shouldReturnRows = false
    let countExact = false
    let orderBy: { column: string; ascending: boolean } | null = null
    let page: [number, number] | null = null
    let mutation: Mutation = null
    let response: QueryResponse | null = null

    function execute(): QueryResponse {
      if (response) return response

      let affectedRows: FilteringRow[] | null = null
      if (mutation?.kind === 'insert') {
        affectedRows = mutation.values.map((input) => {
          const row = { ...input }
          if (row.id === undefined) row.id = `${table}-generated-${++generatedId}`
          tableRows(table).push(row)
          return row
        })
      } else if (mutation?.kind === 'upsert') {
        const upsert = mutation
        affectedRows = upsert.values.map((input) => {
          const rows = tableRows(table)
          const existing = upsert.onConflict.length
            ? rows.find((row) => upsert.onConflict.every((column) => row[column] === input[column]))
            : undefined
          if (existing) {
            Object.assign(existing, input)
            return existing
          }
          const row = { ...input }
          if (row.id === undefined) row.id = `${table}-generated-${++generatedId}`
          rows.push(row)
          return row
        })
      } else if (mutation?.kind === 'update') {
        affectedRows = tableRows(table).filter((row) => matches(table, row, filters))
        for (const row of affectedRows) Object.assign(row, mutation.values)
      } else if (mutation?.kind === 'delete') {
        const rows = tableRows(table)
        affectedRows = rows.filter((row) => matches(table, row, filters))
        const deleted = new Set(affectedRows)
        tables.set(table, rows.filter((row) => !deleted.has(row)))
      }

      let resultRows = mutation
        ? shouldReturnRows ? affectedRows ?? [] : null
        : tableRows(table).filter((row) => matches(table, row, filters))
      const exactCount = Array.isArray(resultRows) ? resultRows.length : 0

      if (Array.isArray(resultRows) && orderBy) {
        const { column, ascending } = orderBy
        resultRows = resultRows.slice().sort((left, right) => {
          const leftValue = columnValues(table, left, column)[0]
          const rightValue = columnValues(table, right, column)[0]
          const difference = compare(leftValue, rightValue)
          return ascending ? difference : -difference
        })
      }
      if (Array.isArray(resultRows) && page) resultRows = resultRows.slice(page[0], page[1] + 1)

      response = {
        data: resultRows,
        error: null,
        count: countExact ? exactCount : null,
      }
      return response
    }

    function asSingle(requireOne: boolean): Promise<QueryResponse> {
      const result = execute()
      const rows = Array.isArray(result.data) ? result.data : []
      if (rows.length > 1 || (requireOne && rows.length !== 1)) {
        return Promise.resolve({
          ...result,
          data: null,
          error: { message: rows.length > 1 ? 'JSON object requested, multiple rows returned' : 'No rows returned' },
        })
      }
      return Promise.resolve({ ...result, data: rows[0] ?? null })
    }

    const query: QueryBuilder = {
      select(columns, options) {
        void columns
        shouldReturnRows = true
        countExact = options?.count === 'exact'
        return query
      },
      eq(column, value) { filters = [...filters, { kind: 'eq', column, value }]; return query },
      in(column, values) { filters = [...filters, { kind: 'in', column, value: values }]; return query },
      is(column, value) { filters = [...filters, { kind: 'is', column, value }]; return query },
      not(column, operator, value) { filters = [...filters, { kind: 'not', column, operator, value }]; return query },
      order(column, options) { orderBy = { column, ascending: options?.ascending ?? false }; return query },
      range(from, to) { page = [from, to]; return query },
      maybeSingle() { return asSingle(false) },
      single() { return asSingle(true) },
      insert(values) {
        const list: readonly FilteringRow[] = Array.isArray(values) ? values : [values]
        mutation = { kind: 'insert', values: list }
        return query
      },
      update(values) { mutation = { kind: 'update', values }; return query },
      delete() { mutation = { kind: 'delete' }; return query },
      upsert(values, options) {
        const list: readonly FilteringRow[] = Array.isArray(values) ? values : [values]
        mutation = {
          kind: 'upsert',
          values: list,
          onConflict: options?.onConflict?.split(',').map((column) => column.trim()) ?? [],
        }
        return query
      },
      then<TResult1 = QueryResponse, TResult2 = never>(
        onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(execute()).then(onfulfilled ?? undefined, onrejected ?? undefined)
      },
    }
    return query
  }

  const client = {
    from(table: string) { return makeQuery(table) },
  } as unknown as AppSupabaseClient

  return {
    client,
    rows(table) { return tableRows(table).map((row) => ({ ...row })) },
  }
}
