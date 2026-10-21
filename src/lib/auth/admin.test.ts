/* Commento didattico:
 * Scopo del file: fissa il contratto della sessione admin (`@/lib/auth/admin`) e la coerenza con il middleware reale.
 * Moduli richiamati: `node:crypto` (hash scrypt), `vitest`, `next/server`, `@/lib/auth/admin`, `@/middleware`, mock di `@supabase/ssr`.
 * Flusso: crea cookie con la funzione di produzione e verifica che siano accettati o rifiutati allo stesso modo da lettore e middleware.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { randomBytes, scryptSync } from 'node:crypto'

const adminUsername = 'admin'
const adminSecret = 'test-secret-admin-session-0123456789'

const getUserMock = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.maybeSingle = async () => ({ data: { id: 'admin' }, error: null })
      return builder
    }),
  })),
}))

const { buildAdminSessionCookieValue, readAdminSessionFromCookieValue, verifySuperAdminCredentials } = await import('@/lib/auth/admin')
const { middleware } = await import('@/middleware')

function scryptHash(password: string, params = { N: 16384, r: 8, p: 1, keyLen: 64 }): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, params.keyLen, { N: params.N, r: params.r, p: params.p })
  return `scrypt$${params.N}$${params.r}$${params.p}$${params.keyLen}$${salt.toString('base64')}$${derived.toString('base64')}`
}

function setAdminEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    SUPERADMIN_USERNAME: adminUsername,
    SUPERADMIN_SESSION_SECRET: adminSecret,
    SUPERADMIN_PASSWORD_HASH: scryptHash('correct-password'),
    ...overrides,
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      vi.stubEnv(key, '')
    } else {
      vi.stubEnv(key, value)
    }
  }
}

function adminRequest(cookieValue?: string) {
  return new NextRequest('https://utraya.com/api/admin/probe', {
    headers: cookieValue ? { cookie: `cf_admin_session=${cookieValue}` } : undefined,
  })
}

async function middlewareAccepts(cookieValue: string | undefined): Promise<boolean> {
  const response = await middleware(adminRequest(cookieValue))
  return response.status !== 401
}

function tamperSignature(cookie: string): string {
  const [payload, signature] = cookie.split('.')
  const flipped = signature!.slice(0, -1) + (signature!.endsWith('A') ? 'B' : 'A')
  return `${payload}.${flipped}`
}

function tamperPayload(cookie: string, mutate: (parsed: { u: string; exp: number; n: string }) => unknown): string {
  const [payload, signature] = cookie.split('.')
  const parsed = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
  const nextPayload = Buffer.from(JSON.stringify(mutate(parsed)), 'utf8').toString('base64url')
  return `${nextPayload}.${signature}`
}

describe('sessione admin: contratto fra admin.ts e middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setAdminEnv()
    getUserMock.mockResolvedValue({ data: { user: null } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accetta da entrambi il cookie appena creato', async () => {
    const cookie = buildAdminSessionCookieValue(adminUsername)

    expect(readAdminSessionFromCookieValue(cookie)).toEqual({ username: adminUsername })
    await expect(middlewareAccepts(cookie)).resolves.toBe(true)
  })

  it('rifiuta da entrambi la firma alterata', async () => {
    const cookie = tamperSignature(buildAdminSessionCookieValue(adminUsername))

    expect(readAdminSessionFromCookieValue(cookie)).toBeNull()
    await expect(middlewareAccepts(cookie)).resolves.toBe(false)
  })

  it('rifiuta da entrambi il payload alterato (username)', async () => {
    const cookie = tamperPayload(buildAdminSessionCookieValue(adminUsername), (parsed) => ({ ...parsed, u: 'altro-admin' }))

    expect(readAdminSessionFromCookieValue(cookie)).toBeNull()
    await expect(middlewareAccepts(cookie)).resolves.toBe(false)
  })

  it('rifiuta da entrambi il payload alterato (exp)', async () => {
    const cookie = tamperPayload(buildAdminSessionCookieValue(adminUsername), (parsed) => ({ ...parsed, exp: parsed.exp + 60_000 }))

    expect(readAdminSessionFromCookieValue(cookie)).toBeNull()
    await expect(middlewareAccepts(cookie)).resolves.toBe(false)
  })

  it('rifiuta da entrambi un cookie scaduto oltre le 12 ore', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const cookie = buildAdminSessionCookieValue(adminUsername)
    // Oltre la durata di sessione (12 h) e oltre `exp`.
    vi.setSystemTime(new Date('2026-01-02T00:00:01.000Z'))

    expect(readAdminSessionFromCookieValue(cookie)).toBeNull()
    await expect(middlewareAccepts(cookie)).resolves.toBe(false)
    vi.useRealTimers()
  })

  it('rifiuta da entrambi un cookie firmato con un\'altra secret', async () => {
    const cookie = buildAdminSessionCookieValue(adminUsername)

    vi.stubEnv('SUPERADMIN_SESSION_SECRET', 'test-secret-other-9876543210')
    expect(readAdminSessionFromCookieValue(cookie)).toBeNull()
    await expect(middlewareAccepts(cookie)).resolves.toBe(false)
  })

  it('rifiuta da entrambi un valore senza punto', async () => {
    expect(readAdminSessionFromCookieValue('senza-punto')).toBeNull()
    await expect(middlewareAccepts('senza-punto')).resolves.toBe(false)
  })

  it('rifiuta da entrambi la stringa vuota e il valore assente', async () => {
    expect(readAdminSessionFromCookieValue('')).toBeNull()
    expect(readAdminSessionFromCookieValue(undefined)).toBeNull()
    await expect(middlewareAccepts('')).resolves.toBe(false)
    await expect(middlewareAccepts(undefined)).resolves.toBe(false)
  })

  it('rifiuta da entrambi quando la secret non è configurata', async () => {
    vi.stubEnv('SUPERADMIN_SESSION_SECRET', '')
    const cookie = `${Buffer.from(JSON.stringify({ u: adminUsername, exp: Date.now() + 60_000 }), 'utf8').toString('base64url')}.firma`

    expect(readAdminSessionFromCookieValue(cookie)).toBeNull()
    await expect(middlewareAccepts(cookie)).resolves.toBe(false)
  })

  it('buildAdminSessionCookieValue lancia se la configurazione è incompleta', () => {
    vi.stubEnv('SUPERADMIN_SESSION_SECRET', '')
    expect(() => buildAdminSessionCookieValue(adminUsername)).toThrow()
  })
})

describe('verifySuperAdminCredentials', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accetta username e password corretti', () => {
    setAdminEnv()
    expect(verifySuperAdminCredentials(adminUsername, 'correct-password')).toBe(true)
  })

  it('normalizza gli spazi attorno allo username', () => {
    setAdminEnv()
    expect(verifySuperAdminCredentials(`  ${adminUsername}  `, 'correct-password')).toBe(true)
  })

  it('rifiuta la password errata', () => {
    setAdminEnv()
    expect(verifySuperAdminCredentials(adminUsername, 'wrong-password')).toBe(false)
  })

  it('rifiuta lo username errato', () => {
    setAdminEnv()
    expect(verifySuperAdminCredentials('intruso', 'correct-password')).toBe(false)
  })

  it('rifiuta un hash che non inizia con scrypt$', () => {
    setAdminEnv({ SUPERADMIN_PASSWORD_HASH: 'bcrypt$16384$8$1$64$c2FsdA==$aGFzaA==' })
    expect(verifySuperAdminCredentials(adminUsername, 'correct-password')).toBe(false)
  })

  it('rifiuta un hash con parti mancanti', () => {
    setAdminEnv({ SUPERADMIN_PASSWORD_HASH: 'scrypt$16384$8$1$64$c2FsdA==' })
    expect(verifySuperAdminCredentials(adminUsername, 'correct-password')).toBe(false)
  })

  it('rifiuta un hash con parametri numerici non validi', () => {
    setAdminEnv({ SUPERADMIN_PASSWORD_HASH: 'scrypt$abc$8$1$64$c2FsdA==$aGFzaA==' })
    expect(verifySuperAdminCredentials(adminUsername, 'correct-password')).toBe(false)
  })

  it('rifiuta quando la configurazione è assente', () => {
    setAdminEnv({ SUPERADMIN_USERNAME: '', SUPERADMIN_PASSWORD_HASH: '', SUPERADMIN_SESSION_SECRET: '' })
    expect(verifySuperAdminCredentials(adminUsername, 'correct-password')).toBe(false)
  })
})