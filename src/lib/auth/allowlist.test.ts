import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isEmailAllowlisted, provisionNewUser } from '@/lib/auth/allowlist'

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

type DbError = { code?: string; message: string }
type QueryResult = { data: unknown; error: DbError | null }

function createProvisioningClient(options: {
  defaultWatchlistReads?: QueryResult[]
  defaultWatchlistInsertError?: DbError | null
  defaultUserRead?: QueryResult
} = {}) {
  const userReadMock = vi.fn().mockResolvedValue(options.defaultUserRead ?? { data: null, error: null })
  const userWriteMock = vi.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null })
  const identityUpsertMock = vi.fn().mockResolvedValue({ error: null })
  const roleReadMock = vi.fn().mockResolvedValue({ data: { id: 'role-user' }, error: null })
  const userRoleUpsertMock = vi.fn().mockResolvedValue({ error: null })
  const defaultWatchlistReadMock = vi.fn()
  for (const result of options.defaultWatchlistReads ?? [{ data: null, error: null }]) {
    defaultWatchlistReadMock.mockResolvedValueOnce(result)
  }
  const defaultWatchlistInsertMock = vi.fn().mockResolvedValue({ error: options.defaultWatchlistInsertError ?? null })

  const usersSelectMock = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: userReadMock })) }))
  const usersUpsertMock = vi.fn(() => ({ select: vi.fn(() => ({ single: userWriteMock })) }))
  const rolesSelectMock = vi.fn(() => ({ eq: vi.fn(() => ({ single: roleReadMock })) }))
  const watchlistsSelectMock = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: defaultWatchlistReadMock })) })),
  }))

  const fromMock = vi.fn((table: string) => {
    if (table === 'users') return { select: usersSelectMock, upsert: usersUpsertMock }
    if (table === 'user_identities') return { upsert: identityUpsertMock }
    if (table === 'roles') return { select: rolesSelectMock }
    if (table === 'user_roles') return { upsert: userRoleUpsertMock }
    if (table === 'watchlists') return { select: watchlistsSelectMock, insert: defaultWatchlistInsertMock }
    throw new Error(`Tabella inattesa nel test: ${table}`)
  })

  createAdminClientMock.mockReturnValue({ from: fromMock })
  return { defaultWatchlistReadMock, defaultWatchlistInsertMock, fromMock }
}

const userParams = {
  supabaseUserId: 'user-1',
  email: 'user@example.com',
  displayName: 'Utente',
  avatarUrl: null,
  provider: 'google',
  providerUserId: 'google-user-1',
}

describe('provisionNewUser default watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mantiene intatta la watchlist default già personalizzata', async () => {
    const { defaultWatchlistReadMock, defaultWatchlistInsertMock } = createProvisioningClient({
      defaultWatchlistReads: [{ data: { id: 'custom-default' }, error: null }],
    })

    await expect(provisionNewUser(userParams)).resolves.toEqual({ success: true, userId: 'user-1' })

    expect(defaultWatchlistReadMock).toHaveBeenCalledTimes(1)
    expect(defaultWatchlistInsertMock).not.toHaveBeenCalled()
  })

  it('inserisce la watchlist default quando non ne esiste una', async () => {
    const { defaultWatchlistInsertMock } = createProvisioningClient()

    await expect(provisionNewUser(userParams)).resolves.toEqual({ success: true, userId: 'user-1' })

    expect(defaultWatchlistInsertMock).toHaveBeenCalledWith({
      user_id: 'user-1',
      name: 'Da vedere',
      is_default: true,
    })
  })

  it('accetta il default creato dalla callback concorrente dopo una violazione 23505', async () => {
    const { defaultWatchlistReadMock, defaultWatchlistInsertMock } = createProvisioningClient({
      defaultWatchlistReads: [
        { data: null, error: null },
        { data: { id: 'concurrent-default' }, error: null },
      ],
      defaultWatchlistInsertError: { code: '23505', message: 'duplicate key' },
    })

    await expect(provisionNewUser(userParams)).resolves.toEqual({ success: true, userId: 'user-1' })

    expect(defaultWatchlistInsertMock).toHaveBeenCalledTimes(1)
    expect(defaultWatchlistReadMock).toHaveBeenCalledTimes(2)
  })

  it('non considera risolto un 23505 se il re-read non trova il default', async () => {
    const { defaultWatchlistReadMock } = createProvisioningClient({
      defaultWatchlistReads: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      defaultWatchlistInsertError: { code: '23505', message: 'duplicate key' },
    })

    await expect(provisionNewUser(userParams)).resolves.toMatchObject({ success: false, error: 'duplicate key' })
    expect(defaultWatchlistReadMock).toHaveBeenCalledTimes(2)
  })

  it('propaga gli errori del re-read dopo una violazione 23505', async () => {
    createProvisioningClient({
      defaultWatchlistReads: [
        { data: null, error: null },
        { data: null, error: { message: 're-read failed' } },
      ],
      defaultWatchlistInsertError: { code: '23505', message: 'duplicate key' },
    })

    await expect(provisionNewUser(userParams)).resolves.toMatchObject({ success: false, error: 're-read failed' })
  })

  it('propaga gli errori di lookup e gli errori insert diversi da 23505', async () => {
    createProvisioningClient({
      defaultWatchlistReads: [{ data: null, error: { message: 'lookup failed' } }],
    })
    await expect(provisionNewUser(userParams)).resolves.toMatchObject({ success: false, error: 'lookup failed' })

    const { defaultWatchlistReadMock, defaultWatchlistInsertMock } = createProvisioningClient({
      defaultWatchlistInsertError: { code: '500', message: 'insert failed' },
    })
    await expect(provisionNewUser(userParams)).resolves.toMatchObject({ success: false, error: 'insert failed' })
    expect(defaultWatchlistReadMock).toHaveBeenCalledTimes(1)
    expect(defaultWatchlistInsertMock).toHaveBeenCalledTimes(1)
  })
})

type AllowlistEntry = { email: string; is_active: boolean }
type AllowlistError = { message: string }

/** Il fake applica i filtri alla riga, invece di restituire sempre un risultato prestabilito. */
function matchesIlikePattern(value: string, pattern: string): boolean {
  let expression = '^'
  let escaped = false
  for (const character of pattern) {
    if (escaped) {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '*' || character === '%') {
      // PostgREST converte `*` in `%` prima di inviare il pattern a PostgreSQL.
      expression += '.*'
    } else if (character === '_') {
      expression += '.'
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  if (escaped) expression += '\\\\'
  return new RegExp(`${expression}$`, 'i').test(value)
}

function createAllowlistClient(options: {
  rows?: readonly AllowlistEntry[]
  error?: AllowlistError | null
} = {}) {
  const eqCalls: Array<[string, unknown]> = []
  let ilikeFilter: [string, string] | null = null

  function execute(requireOne: boolean) {
    if (options.error) return Promise.resolve({ data: null, error: options.error })

    const row = (options.rows ?? []).find((candidate) => {
      const equalsMatch = eqCalls.every(([column, expected]) => candidate[column as keyof AllowlistEntry] === expected)
      const patternMatch = !ilikeFilter || (
        ilikeFilter[0] === 'email' && matchesIlikePattern(candidate.email, ilikeFilter[1])
      )
      return equalsMatch && patternMatch
    })

    if (!row) {
      return Promise.resolve({
        data: null,
        error: requireOne ? { message: 'no rows' } : null,
      })
    }
    return Promise.resolve({ data: { id: 'entry-1', is_active: row.is_active }, error: null })
  }

  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value])
      return query
    }),
    ilike: vi.fn((column: string, pattern: string) => {
      ilikeFilter = [column, pattern]
      return query
    }),
    maybeSingle: vi.fn(() => execute(false)),
    single: vi.fn(() => execute(true)),
  }
  const selectMock = vi.fn(() => query)
  const fromMock = vi.fn(() => ({ select: selectMock }))
  createAdminClientMock.mockReturnValue({ from: fromMock })

  return { fromMock, selectMock, eqMock: query.eq, ilikeMock: query.ilike, maybeSingleMock: query.maybeSingle }
}

describe('isEmailAllowlisted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('autorizza una email attiva presente in allowlist', async () => {
    createAllowlistClient({ rows: [{ email: 'utente@example.com', is_active: true }] })

    await expect(isEmailAllowlisted('utente@example.com')).resolves.toBe(true)
  })

  it('nega una email assente in allowlist', async () => {
    createAllowlistClient()

    await expect(isEmailAllowlisted('assente@example.com')).resolves.toBe(false)
  })

  it('nega una email presente ma con is_active falso', async () => {
    createAllowlistClient({ rows: [{ email: 'disattivata@example.com', is_active: false }] })

    await expect(isEmailAllowlisted('disattivata@example.com')).resolves.toBe(false)
  })

  it('normalizza spazi e maiuscole prima del confronto esatto', async () => {
    const { eqMock, maybeSingleMock } = createAllowlistClient({
      rows: [{ email: 'utente@example.com', is_active: true }],
    })

    await expect(isEmailAllowlisted('  Utente@Example.com  ')).resolves.toBe(true)

    expect(eqMock).toHaveBeenCalledWith('email', 'utente@example.com')
    expect(eqMock).toHaveBeenCalledWith('is_active', true)
    expect(maybeSingleMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['asterisco', 'user*name@example.com', 'username@example.com'],
    ['percentuale', 'user%name@example.com', 'userXname@example.com'],
    ['underscore', 'user_name@example.com', 'userXname@example.com'],
    ['barra inversa', 'user\\name@example.com', 'username@example.com'],
  ])('non autorizza una email diversa con il carattere speciale: %s', async (_nome, email, altraEmail) => {
    const { eqMock } = createAllowlistClient({ rows: [{ email: altraEmail, is_active: true }] })

    await expect(isEmailAllowlisted(email)).resolves.toBe(false)

    expect(eqMock).toHaveBeenCalledWith('email', email)
  })

  it('nega con fail-closed quando la query restituisce un errore DB', async () => {
    createAllowlistClient({ error: { message: 'connection refused' } })

    await expect(isEmailAllowlisted('utente@example.com')).resolves.toBe(false)
  })
})
