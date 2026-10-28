import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  adminRequest,
  adminSessionCookieName,
  adminUsername,
  createSupabaseAdminFake,
  setAdminEnv,
  validAdminSessionCookie,
  type SupabaseAdminFake,
} from '@/__tests__/admin-route-helpers'

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: cookiesMock }))

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import { DELETE } from '@/app/api/admin/users/[userId]/route'

const validUserId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

let fake: SupabaseAdminFake
let sessionCookie: string | undefined

function deleteUser(userId: string, options: { body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) {
  const url = `https://utraya.com/api/admin/users/${userId}`
  return DELETE(
    adminRequest({ url, method: 'DELETE', body: options.body ?? { reason: 'richiesta utente' }, origin: options.origin, headers: options.headers }),
    { params: Promise.resolve({ userId }) }
  )
}

describe('DELETE /api/admin/users/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAdminEnv()
    fake = createSupabaseAdminFake()
    createAdminClientMock.mockReturnValue(fake.client)
    sessionCookie = validAdminSessionCookie()
    cookiesMock.mockImplementation(() => ({
      get: (name: string) => (name === adminSessionCookieName && sessionCookie ? { name, value: sessionCookie } : undefined),
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rifiuta con 401 senza sessione senza invocare la cancellazione', async () => {
    sessionCookie = undefined

    const response = await deleteUser(validUserId)

    expect(response.status).toBe(401)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('invoca la cancellazione forzata per l\'id indicato e scrive l\'audit', async () => {
    const response = await deleteUser(validUserId)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { deleted: true } })

    expect(fake.rpcCalls).toEqual([
      { fn: 'execute_user_deletion', args: { p_user_id: validUserId } },
    ])

    const audit = fake.inserts.find((entry) => entry.table === 'app_logs')
    expect(audit?.values).toMatchObject({ level: 'warn', message: 'force_delete_user' })
    expect(audit?.values.context).toMatchObject({ admin_username: adminUsername, reason: 'richiesta utente' })
    // L'id utente non è mai in chiaro nell'audit.
    expect(JSON.stringify(audit?.values)).not.toContain(validUserId)
  })

  it('rifiuta con 400 un motivo mancante senza invocare la cancellazione', async () => {
    const response = await deleteUser(validUserId, { body: {} })

    expect(response.status).toBe(400)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('rifiuta con 403 una origin diversa', async () => {
    const response = await deleteUser(validUserId, { origin: 'https://attacker.example' })

    expect(response.status).toBe(403)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('rifiuta con 403 quando l\'origin è assente', async () => {
    const response = await deleteUser(validUserId, { origin: null })

    expect(response.status).toBe(403)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('rifiuta con 415 un content-type non JSON', async () => {
    const response = await deleteUser(validUserId, { headers: { 'content-type': 'text/plain' } })

    expect(response.status).toBe(415)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('risponde 500 sanitizzato se la cancellazione fallisce', async () => {
    fake.setWriteError({ message: 'errore RPC con password=segreta' })

    const response = await deleteUser(validUserId)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('segreta')
  })

  it('rifiuta con 400 un id non UUID senza invocare la cancellazione', async () => {
    const response = await deleteUser('not-a-uuid')

    expect(response.status).toBe(400)
    expect(fake.rpcCalls).toHaveLength(0)
  })
})
