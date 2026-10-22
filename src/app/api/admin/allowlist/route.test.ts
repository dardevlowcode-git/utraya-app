/* Commento didattico:
 * Scopo del file: verifica il confine HTTP dell'allowlist admin (sessione, origin, validazione email, DB normalizzato, audit).
 * Moduli richiamati: route `admin/allowlist` reale, `@/lib/auth/admin` e `@/lib/security/http` reali, DB admin finto, `next/headers` finto.
 * Flusso: invoca POST/DELETE reali con env admin impostata e cookie sessione vero, controllando chiamate DB e risposte.
 */

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

// `cookies()` finto: il valore è letto da `adminSessionCookie` ad ogni chiamata, come farebbe Next.
const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: cookiesMock }))

// Solo il client Supabase admin è sostituito: auth admin e security http restano reali.
const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import { DELETE, POST } from '@/app/api/admin/allowlist/route'

const allowlistUrl = 'https://utraya.com/api/admin/allowlist'

let fake: SupabaseAdminFake
let sessionCookie: string | undefined

function authenticated() {
  sessionCookie = validAdminSessionCookie()
}

function anonymous() {
  sessionCookie = undefined
}

function post(body: unknown, init: { origin?: string | null } = {}) {
  return POST(adminRequest({ url: allowlistUrl, method: 'POST', body, origin: init.origin }))
}

function del(body: unknown, origin?: string | null) {
  return DELETE(adminRequest({ url: allowlistUrl, method: 'DELETE', body, origin }))
}

describe('route admin allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAdminEnv()
    fake = createSupabaseAdminFake()
    createAdminClientMock.mockReturnValue(fake.client)
    authenticated()
    cookiesMock.mockImplementation(() => ({
      get: (name: string) => (name === adminSessionCookieName && sessionCookie ? { name, value: sessionCookie } : undefined),
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rifiuta POST senza sessione con 401 senza toccare il DB', async () => {
    anonymous()

    const response = await post({ email: 'nuovo@example.com' })

    expect(response.status).toBe(401)
    expect(fake.inserts).toHaveLength(0)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('rifiuta DELETE senza sessione con 401 senza toccare il DB', async () => {
    anonymous()

    const response = await del({ email: 'nuovo@example.com' })

    expect(response.status).toBe(401)
    expect(fake.inserts).toHaveLength(0)
  })

  it('aggiunge l\'email normalizzata con upsert e scrive l\'audit', async () => {
    const response = await post({ email: '  Nuovo.User@Example.COM  ' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { email: 'nuovo.user@example.com' } })

    const upsert = fake.inserts.find((entry) => entry.table === 'allowlist_entries')
    expect(upsert?.values).toMatchObject({ email: 'nuovo.user@example.com', is_active: true })

    const audit = fake.inserts.find((entry) => entry.values.action === 'admin_allowlist_add')
    expect(audit?.values).toMatchObject({ resource_id: 'nuovo.user@example.com' })
  })

  it('rimuove l\'email normalizzata con update e scrive l\'audit di revoca', async () => {
    const response = await del({ email: 'Da.Revocare@Example.com' })

    expect(response.status).toBe(200)
    const update = fake.updates.find((entry) => entry.table === 'allowlist_entries')
    expect(update?.values).toMatchObject({ is_active: false })
    expect(update?.filters).toMatchObject({ email: 'da.revocare@example.com' })

    const audit = fake.inserts.find((entry) => entry.values.action === 'admin_allowlist_revoke')
    expect(audit?.values).toMatchObject({ resource_id: 'da.revocare@example.com' })
  })

  it('rifiuta con 400 un\'email malformata senza scrivere in allowlist', async () => {
    const response = await post({ email: 'non-una-email' })

    expect(response.status).toBe(400)
    expect(fake.inserts.find((entry) => entry.table === 'allowlist_entries')).toBeUndefined()
  })

  it('rifiuta con 400 un body con campi extra (schema non accettato)', async () => {
    const response = await post({ email: 'ok@example.com', is_active: true, admin_username: 'attacker' })

    expect(response.status).toBe(400)
    expect(fake.inserts).toHaveLength(0)
  })

  it('rifiuta con 400 un body senza email', async () => {
    const response = await post({})

    expect(response.status).toBe(400)
    expect(fake.inserts).toHaveLength(0)
  })

  it('rifiuta con 403 una origin diversa senza mutare dati', async () => {
    const response = await post({ email: 'ok@example.com' }, { origin: 'https://attacker.example' })

    expect(response.status).toBe(403)
    expect(fake.inserts).toHaveLength(0)
  })

  it('rifiuta con 403 quando l\'origin è assente', async () => {
    const response = await post({ email: 'ok@example.com' }, { origin: null })

    expect(response.status).toBe(403)
    expect(fake.inserts).toHaveLength(0)
  })
})
