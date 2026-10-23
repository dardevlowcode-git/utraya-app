/* Commento didattico:
 * Scopo del file: fornisce impalcatura condivisa per i test delle route admin (env, hash scrypt, sessione, DB finto).
 * Moduli richiamati: `node:crypto`, `vitest`, `@/lib/auth/admin`.
 * Flusso: i test delle route admin usano queste funzioni per impostare l'ambiente super-admin e iniettare cookie senza rete.
 */

import { randomBytes, scryptSync } from 'node:crypto'
import { vi } from 'vitest'
import {
  adminSessionCookieName,
  buildAdminSessionCookieValue,
} from '@/lib/auth/admin'

export const adminUsername = 'admin'
export const adminPassword = 'test-admin-password'
export const adminSessionSecret = 'test-secret-admin-session-0123456789'

/**
 * Genera un hash scrypt nel formato atteso da `verifySuperAdminCredentials`.
 */
export function scryptHash(password: string, params = { N: 16384, r: 8, p: 1, keyLen: 64 }): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, params.keyLen, { N: params.N, r: params.r, p: params.p })
  return `scrypt$${params.N}$${params.r}$${params.p}$${params.keyLen}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/**
 * Imposta l'ambiente super-admin usato dalle route e da `@/lib/auth/admin`.
 * Passa `undefined` per rimuovere una variabile (via `vi.stubEnv(key, '')`).
 */
export function setAdminEnv(overrides: Record<string, string | undefined> = {}): void {
  const env: Record<string, string | undefined> = {
    SUPERADMIN_USERNAME: adminUsername,
    SUPERADMIN_PASSWORD_HASH: scryptHash(adminPassword),
    SUPERADMIN_SESSION_SECRET: adminSessionSecret,
    ...overrides,
  }
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value === undefined ? '' : value)
  }
}

/**
 * Costruisce un cookie di sessione admin valido riusando la funzione di produzione.
 */
export function validAdminSessionCookie(): string {
  return buildAdminSessionCookieValue(adminUsername)
}

export type AdminFakeRequestInit = {
  url: string
  method: string
  body?: unknown
  origin?: string | null
  cookies?: Record<string, string | undefined>
  headers?: Record<string, string>
}

/**
 * Costruisce una richiesta verso una route admin con origin coerente e cookie opzionale.
 * `origin: null` omette l'header; `body` viene serializzato solo se `raw` non è passato.
 */
export function adminRequest(input: AdminFakeRequestInit & { rawBody?: string }): Request {
  const headers: Record<string, string> = { ...input.headers }
  headers['content-type'] = headers['content-type'] ?? 'application/json'
  const origin = input.origin === undefined ? new URL(input.url).origin : input.origin
  if (origin !== null) headers.origin = origin

  const cookiePairs = Object.entries(input.cookies ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
  if (cookiePairs.length > 0) headers.cookie = cookiePairs.join('; ')

  const hasBody = input.method !== 'GET' && input.method !== 'HEAD'
  const body = input.rawBody !== undefined ? input.rawBody : hasBody ? JSON.stringify(input.body ?? {}) : undefined

  return new Request(input.url, { method: input.method, headers, body })
}

type TableResult = { count?: number | null; data?: unknown; error?: { message: string } | null }

export type SupabaseAdminFake = ReturnType<typeof createSupabaseAdminFake>

/**
 * Crea un fake del client Supabase admin per testare le route admin senza DB reale.
 * Espone le operazioni registrate e consente di forzare errori di lettura/scrittura.
 */
export function createSupabaseAdminFake() {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = []
  const updates: Array<{ table: string; values: Record<string, unknown>; filters: Record<string, unknown> }> = []
  const rpcCalls: Array<{ fn: string; args: unknown }> = []
  let selectCount = 0
  let selectError: { message: string } | null = null
  let writeError: { message: string } | null = null
  let countResolver: ((entry: { table: string; filters: Record<string, unknown> }) => number) | null = null

  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    const chain = (method: string) => (...args: unknown[]) => {
      if (method === 'eq') filters[String(args[0])] = args[1]
      if (method === 'gte') filters[`gte:${String(args[0])}`] = args[1]
      return builder
    }
    for (const method of ['eq', 'gte', 'lte', 'lt', 'select', 'order', 'limit', 'single', 'maybeSingle']) {
      builder[method] = chain(method)
    }
    builder.insert = async (values: Record<string, unknown>) => {
      inserts.push({ table, values })
      return { error: writeError }
    }
    builder.upsert = async (values: Record<string, unknown>) => {
      inserts.push({ table, values })
      return { error: writeError }
    }
    builder.update = (values: Record<string, unknown>) => {
      builder.__pendingUpdate = { table, values, filters }
      return builder
    }
    builder.then = (resolve: (value: TableResult) => unknown, reject?: (reason: unknown) => unknown) => {
      const pending = builder.__pendingUpdate as { table: string; values: Record<string, unknown>; filters: Record<string, unknown> } | undefined
      if (pending) {
        updates.push({ table: pending.table, values: pending.values, filters: pending.filters })
        return Promise.resolve({ error: writeError }).then(resolve, reject)
      }
      reads.push({ table, filters })
      const count = countResolver ? countResolver({ table, filters }) : selectCount
      return Promise.resolve({ count, data: [], error: selectError }).then(resolve, reject)
    }
    return builder
  }

  const client = {
    from: (table: string) => makeBuilder(table),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return { data: null, error: writeError }
    },
  }

  return {
    client,
    inserts,
    reads,
    updates,
    rpcCalls,
    setSelectCount: (value: number) => { selectCount = value },
    setSelectError: (value: { message: string } | null) => { selectError = value },
    setWriteError: (value: { message: string } | null) => { writeError = value },
    setCountResolver: (value: ((entry: { table: string; filters: Record<string, unknown> }) => number) | null) => { countResolver = value },
  }
}

export { adminSessionCookieName }