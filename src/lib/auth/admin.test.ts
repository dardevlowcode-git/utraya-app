/* Commento didattico:
 * Scopo del file: fissa il contratto della sessione admin (`@/lib/auth/admin`) e la coerenza con il middleware reale.
 * Moduli richiamati: `node:crypto` (hash scrypt), `vitest`, `next/server`, `@/lib/auth/admin`, `@/middleware`, mock di `@supabase/ssr`.
 * Flusso: crea cookie con la funzione di produzione e verifica che siano accettati o rifiutati allo stesso modo da lettore e middleware.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { adminPassword, adminUsername, setAdminEnv } from '@/__tests__/admin-route-helpers'
import { createSupabaseSsrFake } from '@/__tests__/helpers/supabaseSsrFake'

const getUserMock = vi.fn()
const rpcMock = vi.fn()
const maybeSingleMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => createSupabaseSsrFake({ getUserMock, rpcMock, maybeSingleMock, fromMock })) }))

const { buildAdminSessionCookieValue, readAdminSessionFromCookieValue, verifySuperAdminCredentials } = await import('@/lib/auth/admin')
const { middleware } = await import('@/middleware')

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
  // Cambia il primo carattere: l'ultimo porta bit di riempimento base64url e
  // alterarlo può lasciare invariati i byte decodificati della firma.
  const flipped = (signature!.startsWith('A') ? 'B' : 'A') + signature!.slice(1)
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
    rpcMock.mockResolvedValue({ data: true, error: null })
    maybeSingleMock.mockResolvedValue({ data: { id: adminUsername }, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
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
  })

  it('rifiuta da entrambi un cookie firmato con un\'altra secret', async () => {
    const cookie = buildAdminSessionCookieValue(adminUsername)

    vi.stubEnv('SUPERADMIN_SESSION_SECRET', 'test-session-secret-not-a-real-key-for-invalid-signature')
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
    expect(verifySuperAdminCredentials(adminUsername, adminPassword)).toBe(true)
  })

  it('normalizza gli spazi attorno allo username', () => {
    setAdminEnv()
    expect(verifySuperAdminCredentials(`  ${adminUsername}  `, adminPassword)).toBe(true)
  })

  it('rifiuta la password errata', () => {
    setAdminEnv()
    expect(verifySuperAdminCredentials(adminUsername, 'wrong-password')).toBe(false)
  })

  it('rifiuta lo username errato', () => {
    setAdminEnv()
    expect(verifySuperAdminCredentials('intruso', adminPassword)).toBe(false)
  })

  it('rifiuta un hash che non inizia con scrypt$', () => {
    setAdminEnv({ SUPERADMIN_PASSWORD_HASH: 'bcrypt$16384$8$1$64$c2FsdA==$aGFzaA==' })
    expect(verifySuperAdminCredentials(adminUsername, adminPassword)).toBe(false)
  })

  it('rifiuta un hash con parti mancanti', () => {
    setAdminEnv({ SUPERADMIN_PASSWORD_HASH: 'scrypt$16384$8$1$64$c2FsdA==' })
    expect(verifySuperAdminCredentials(adminUsername, adminPassword)).toBe(false)
  })

  it('rifiuta un hash con parametri numerici non validi', () => {
    setAdminEnv({ SUPERADMIN_PASSWORD_HASH: 'scrypt$abc$8$1$64$c2FsdA==$aGFzaA==' })
    expect(verifySuperAdminCredentials(adminUsername, adminPassword)).toBe(false)
  })

  it('rifiuta quando la configurazione è assente', () => {
    setAdminEnv({ SUPERADMIN_USERNAME: '', SUPERADMIN_PASSWORD_HASH: '', SUPERADMIN_SESSION_SECRET: '' })
    expect(verifySuperAdminCredentials(adminUsername, adminPassword)).toBe(false)
  })
})
