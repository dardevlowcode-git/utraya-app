/* Commento didattico:
 * Scopo del file: verifica la barriera di autenticazione della superficie /api/v1 (Bearer + allowlist + stato) senza rete.
 * Moduli richiamati: `getApiUser`, client Supabase Bearer finto, client admin finto, `vitest`.
 * Flusso: finge solo i confini esterni (createClient, createAdminClient) ed esercita esiti e side effect osservabili.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApiUser } from './apiUser'

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

type DbError = { message: string }
type DbResult = { data: unknown; error: DbError | null }
type TableResult = DbResult | (() => Promise<DbResult>)

const activeUser = {
  id: 'user-1',
  email: 'utente@example.com',
}

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-secret-service-role',
}

/**
 * Finge il client admin usato sia da `isEmailAllowlisted` (tabella `allowlist_entries`)
 * sia da `getApiUser` (tabella `users`), registrando le tabelle interrogate.
 */
function createAdminClientFake(tableResults: {
  allowlist_entries?: TableResult
  users?: TableResult
} = {}) {
  const touchedTables: string[] = []
  const usersFilters: Array<[string, unknown]> = []
  const resolved = (result: TableResult | undefined, fallback: DbResult): Promise<DbResult> =>
    Promise.resolve(typeof result === 'function' ? result() : result ?? fallback)

  const fromMock = vi.fn((table: string) => {
    touchedTables.push(table)

    if (table === 'allowlist_entries') {
      return {
        select: vi.fn(() => ({
          ilike: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: () => resolved(tableResults.allowlist_entries, { data: null, error: null }),
            })),
          })),
        })),
      }
    }

    if (table === 'users') {
      const firstEq = vi.fn((column: string, value: unknown) => {
        usersFilters.push([column, value])
        return {
          eq: vi.fn((column2: string, value2: unknown) => {
            usersFilters.push([column2, value2])
            return {
              maybeSingle: () => resolved(tableResults.users, { data: null, error: null }),
            }
          }),
        }
      })
      return { select: vi.fn(() => ({ eq: firstEq })) }
    }

    throw new Error(`Tabella inattesa nel test: ${table}`)
  })

  createAdminClientMock.mockReturnValue({ from: fromMock })
  return { fromMock, touchedTables, usersFilters }
}

/**
 * Finge il client Supabase Bearer creato da `createBearerClient`.
 * `getUserResult` o è il risultato, o una funzione che riceve il token.
 */
function createBearerClientFake(
  getUserResult: DbResult | ((token: string) => DbResult) = { data: { user: activeUser }, error: null }
) {
  const getUserMock = vi.fn((token: string) =>
    Promise.resolve(typeof getUserResult === 'function' ? getUserResult(token) : getUserResult)
  )
  const client = { auth: { getUser: getUserMock } }
  createClientMock.mockReturnValue(client)
  return { client, getUserMock }
}

function bearerRequest(headerValue: string | null) {
  const headers = new Headers()
  if (headerValue !== null) headers.set('authorization', headerValue)
  return new Request('https://example.com/api/v1/me', { headers })
}

describe('getApiUser', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('header Authorization', () => {
    it('rifiuta header assente senza costruire client né interrogare Supabase', async () => {
      const { fromMock } = createAdminClientFake()
      const { getUserMock } = createBearerClientFake()

      await expect(getApiUser(bearerRequest(null))).resolves.toBeNull()

      expect(createClientMock).not.toHaveBeenCalled()
      expect(createAdminClientMock).not.toHaveBeenCalled()
      expect(getUserMock).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
    })

    it('rifiuta schema Basic anche con credenziali plausibili', async () => {
      const { getUserMock } = createBearerClientFake()

      await expect(getApiUser(bearerRequest('Basic dXNlcm5hbWU6cGFzc3dvcmQ='))).resolves.toBeNull()

      expect(createClientMock).not.toHaveBeenCalled()
      expect(getUserMock).not.toHaveBeenCalled()
    })

    it('rifiuta "Bearer" senza token', async () => {
      const { getUserMock } = createBearerClientFake()

      await expect(getApiUser(bearerRequest('Bearer'))).resolves.toBeNull()

      expect(createClientMock).not.toHaveBeenCalled()
      expect(getUserMock).not.toHaveBeenCalled()
    })

    it('rifiuta "Bearer a b" perché il token deve essere un solo blocco', async () => {
      const { getUserMock } = createBearerClientFake()

      await expect(getApiUser(bearerRequest('Bearer a b'))).resolves.toBeNull()

      expect(createClientMock).not.toHaveBeenCalled()
      expect(getUserMock).not.toHaveBeenCalled()
    })

    it('rifiuta token oltre 4096 caratteri', async () => {
      const { getUserMock } = createBearerClientFake()

      await expect(getApiUser(bearerRequest(`Bearer ${'a'.repeat(4097)}`))).resolves.toBeNull()

      expect(createClientMock).not.toHaveBeenCalled()
      expect(getUserMock).not.toHaveBeenCalled()
    })

    it('accetta lo schema bearer in qualunque combinazione di maiuscole', async () => {
      createAdminClientFake({
        allowlist_entries: { data: { id: 'entry-1', is_active: true }, error: null },
        users: { data: { id: activeUser.id }, error: null },
      })
      const { getUserMock } = createBearerClientFake()

      await expect(getApiUser(bearerRequest('bEaReR token-1'))).resolves.not.toBeNull()
      await expect(getApiUser(bearerRequest('BEARER token-2'))).resolves.not.toBeNull()

      expect(getUserMock).toHaveBeenCalledWith('token-1')
      expect(getUserMock).toHaveBeenCalledWith('token-2')
    })
  })

  describe('verifica del token presso Supabase', () => {
    it('rifiuta quando auth.getUser restituisce errore', async () => {
      createAdminClientFake()
      createBearerClientFake({ data: { user: null }, error: { message: 'invalid JWT' } })

      await expect(getApiUser(bearerRequest('Bearer token-1'))).resolves.toBeNull()
    })

    it('rifiuta utente senza id', async () => {
      createAdminClientFake()
      createBearerClientFake({ data: { user: { id: '', email: 'utente@example.com' } }, error: null })

      await expect(getApiUser(bearerRequest('Bearer token-1'))).resolves.toBeNull()
    })

    it('rifiuta utente senza email', async () => {
      const { fromMock } = createAdminClientFake()
      createBearerClientFake({ data: { user: { id: 'user-1', email: undefined } }, error: null })

      await expect(getApiUser(bearerRequest('Bearer token-1'))).resolves.toBeNull()

      expect(fromMock).not.toHaveBeenCalled()
    })

    it('propaga il token al client Bearer usato per la verifica', async () => {
      createAdminClientFake({
        allowlist_entries: { data: { id: 'entry-1', is_active: true }, error: null },
        users: { data: { id: activeUser.id }, error: null },
      })
      const { getUserMock } = createBearerClientFake()

      await getApiUser(bearerRequest('Bearer token-abc'))

      expect(getUserMock).toHaveBeenCalledWith('token-abc')
    })
  })

  describe('allowlist e stato applicativo', () => {
    it('rifiuta email non allowlisted e non legge la tabella users', async () => {
      const { touchedTables } = createAdminClientFake({
        allowlist_entries: { data: null, error: null },
      })
      createBearerClientFake()

      await expect(getApiUser(bearerRequest('Bearer token-1'))).resolves.toBeNull()

      expect(touchedTables).toContain('allowlist_entries')
      expect(touchedTables).not.toContain('users')
    })

    it('rifiuta allowlist in errore senza leggere users (fail-closed)', async () => {
      const { touchedTables } = createAdminClientFake({
        allowlist_entries: { data: null, error: { message: 'allowlist query failed' } },
      })
      createBearerClientFake()

      await expect(getApiUser(bearerRequest('Bearer token-1'))).resolves.toBeNull()

      expect(touchedTables).not.toContain('users')
    })

    it('rifiuta utente allowlisted ma con riga users assente', async () => {
      createAdminClientFake({
        allowlist_entries: { data: { id: 'entry-1', is_active: true }, error: null },
        users: { data: null, error: null },
      })
      createBearerClientFake()

      await expect(getApiUser(bearerRequest('Bearer token-1'))).resolves.toBeNull()
    })

    it('rifiuta utente allowlisted ma non attivo, vincolando id e status nella query', async () => {
      const { usersFilters } = createAdminClientFake({
        allowlist_entries: { data: { id: 'entry-1', is_active: true }, error: null },
        users: { data: null, error: null },
      })
      createBearerClientFake()

      await expect(getApiUser(bearerRequest('Bearer token-1'))).resolves.toBeNull()

      expect(usersFilters).toEqual([
        ['id', activeUser.id],
        ['status', 'active'],
      ])
    })
  })

  describe('caso valido', () => {
    it('restituisce user e il client Bearer, con header Authorization coerente', async () => {
      const { usersFilters } = createAdminClientFake({
        allowlist_entries: { data: { id: 'entry-1', is_active: true }, error: null },
        users: { data: { id: activeUser.id }, error: null },
      })
      const { client } = createBearerClientFake()

      const result = await getApiUser(bearerRequest('Bearer token-valid'))

      expect(result).not.toBeNull()
      expect(result?.user).toMatchObject(activeUser)
      expect(result?.supabase).toBe(client)
      expect(usersFilters).toEqual([
        ['id', activeUser.id],
        ['status', 'active'],
      ])

      const createOptions = createClientMock.mock.calls[0][2] as {
        global?: { headers?: Record<string, string> }
      }
      expect(createOptions.global?.headers?.Authorization).toBe('Bearer token-valid')
    })
  })

  describe('configurazione Supabase', () => {
    it('lancia errore esplicito quando mancano le env anon (non null silenzioso)', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

      await expect(getApiUser(bearerRequest('Bearer token-1'))).rejects.toThrow(
        'Configurazione Supabase incompleta'
      )
    })

    it('lancia errore esplicito quando manca url anon', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')

      await expect(getApiUser(bearerRequest('Bearer token-1'))).rejects.toThrow(
        'Configurazione Supabase incompleta'
      )

      expect(createClientMock).not.toHaveBeenCalled()
    })
  })
})