/* Commento didattico:
 * Scopo del file: verifica il provisioning OAuth e l'idempotenza della watchlist default senza DB reale.
 * Moduli richiamati: `provisionNewUser`, client admin Supabase mockato, `vitest`.
 * Flusso: simula lookup/inserimento e una callback concorrente che vince il vincolo univoco.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { provisionNewUser } from '@/lib/auth/allowlist'

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
