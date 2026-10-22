/* Commento didattico:
 * Scopo del file: verifica la decisione di accesso (`isEmailAllowlisted`) e il provisioning OAuth con watchlist default senza DB reale.
 * Moduli richiamati: `isEmailAllowlisted`, `provisionNewUser`, client admin Supabase mockato, `vitest`.
 * Flusso: simula la lettura della allowlist e lookup/inserimento della callback concorrente che vince il vincolo univoco.
 */

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

type AllowlistResult = { data: unknown; error: { message: string } | null }

/**
 * Finge il client admin per la sola tabella `allowlist_entries`, registrando
 * i filtri applicati alla query così da poterli asserire.
 */
function matchesIlikePattern(value: string, pattern: string): boolean {
  let expression = '^'
  let escaped = false
  for (const character of pattern) {
    if (escaped) {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '%') {
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

function createAllowlistClient(result: AllowlistResult | (() => Promise<AllowlistResult>), databaseEmail?: string) {
  const ilikeMock = vi.fn()
  const eqMock = vi.fn()
  const singleMock = vi.fn(() => {
    if (databaseEmail !== undefined) {
      return Promise.resolve(matchesIlikePattern(databaseEmail, ilikeMock.mock.calls[0]?.[1] as string)
        ? { data: { id: 'entry-1', is_active: true }, error: null }
        : { data: null, error: { message: 'no rows' } })
    }
    return Promise.resolve(typeof result === 'function' ? result() : result)
  })

  const chain = { ilike: ilikeMock, eq: eqMock, single: singleMock }
  ilikeMock.mockReturnValue({ eq: eqMock })
  eqMock.mockReturnValue({ single: singleMock })

  const selectMock = vi.fn(() => ({ ilike: ilikeMock }))
  const fromMock = vi.fn(() => ({ select: selectMock }))
  createAdminClientMock.mockReturnValue({ from: fromMock })

  return { fromMock, selectMock, ilikeMock, eqMock, singleMock }
}

describe('isEmailAllowlisted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('autorizza una email attiva presente in allowlist', async () => {
    createAllowlistClient({ data: { id: 'entry-1', is_active: true }, error: null })

    await expect(isEmailAllowlisted('utente@example.com')).resolves.toBe(true)
  })

  it('nega una email assente in allowlist', async () => {
    createAllowlistClient({ data: null, error: { message: 'no rows' } })

    await expect(isEmailAllowlisted('assente@example.com')).resolves.toBe(false)
  })

  it('nega una email presente ma con is_active falso', async () => {
    createAllowlistClient({ data: { id: 'entry-1', is_active: false }, error: null })

    await expect(isEmailAllowlisted('disattivata@example.com')).resolves.toBe(false)
  })

  it('applica il confronto case-insensitive (ilike) e il filtro is_active', async () => {
    const { ilikeMock, eqMock } = createAllowlistClient({
      data: { id: 'entry-1', is_active: true },
      error: null,
    }, 'utente@example.com')

    await expect(isEmailAllowlisted('Utente@Example.com')).resolves.toBe(true)

    expect(ilikeMock).toHaveBeenCalledWith('email', 'Utente@Example.com')
    expect(eqMock).toHaveBeenCalledWith('is_active', true)
  })

  it.each([
    ['underscore', 'nome_utente@example.com', 'nome\\_utente@example.com'],
    ['percentuale', 'nome%utente@example.com', 'nome\\%utente@example.com'],
    ['backslash', 'nome\\utente@example.com', 'nome\\\\utente@example.com'],
  ])('non autorizza una email diversa con un carattere speciale: %s', async (_nome, email, patternAtteso) => {
    const { ilikeMock } = createAllowlistClient(
      { data: null, error: { message: 'no rows' } },
      'username@example.com'
    )

    await expect(isEmailAllowlisted(email)).resolves.toBe(false)

    expect(ilikeMock).toHaveBeenCalledWith('email', patternAtteso)
  })

  it('normalizza gli spazi ai bordi come fa il codice (trim)', async () => {
    const { ilikeMock } = createAllowlistClient({
      data: { id: 'entry-1', is_active: true },
      error: null,
    })

    await isEmailAllowlisted('   utente@example.com   ')

    expect(ilikeMock).toHaveBeenCalledWith('email', 'utente@example.com')
  })

  it('nega con fail-closed quando la query restituisce un errore DB', async () => {
    createAllowlistClient({ data: null, error: { message: 'connection refused' } })

    await expect(isEmailAllowlisted('utente@example.com')).resolves.toBe(false)
  })
})
