/* Commento didattico:
 * Scopo del file: verifica il confine HTTP del login super-admin (guardie, rate limit per IP, audit e cookie di sessione).
 * Moduli richiamati: route `admin/auth/login` reale, `@/lib/auth/admin` reale, `@/lib/security/http` reale, DB admin finto.
 * Flusso: invoca il POST reale con env admin impostata e client Supabase finto e controlla status, audit e attributi del cookie.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  adminPassword,
  adminRequest,
  adminSessionCookieName,
  adminUsername,
  createSupabaseAdminFake,
  setAdminEnv,
  validAdminSessionCookie,
  type SupabaseAdminFake,
} from '@/__tests__/admin-route-helpers'

// Non si mockano `@/lib/auth/admin` né `@/lib/security/http`: il ticket richiede di provarli reali.
// Solo il client Supabase admin è sostituito.
const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import { POST } from '@/app/api/admin/auth/login/route'
import { readAdminSessionFromCookieValue } from '@/lib/auth/admin'

const loginUrl = 'https://utraya.com/api/admin/auth/login'

// NOTA: il lockout per username (utraya-doc #80) è in discussione e non viene fissato con un test.
// Questo file copre esclusivamente il limite per IP; il ramo `byUsername` resta senza asserzione dedicata.

let fake: SupabaseAdminFake

function setupFake() {
  fake = createSupabaseAdminFake()
  createAdminClientMock.mockReturnValue(fake.client)
  return fake
}

function setCookieHeader(response: Response): string {
  const raw = response.headers.get('set-cookie')
  if (!raw) throw new Error('set-cookie assente nella risposta')
  return raw
}

function postLogin(
  options: { body?: unknown; rawBody?: string; origin?: string | null; ip?: string; contentType?: string | null } = {}
) {
  const headers: Record<string, string> = {}
  if (options.contentType === null) return postWithoutContentType(options)
  if (options.contentType) headers['content-type'] = options.contentType
  if (options.ip) headers['x-real-ip'] = options.ip
  return POST(
    adminRequest({
      url: loginUrl,
      method: 'POST',
      body: options.body ?? { username: adminUsername, password: adminPassword },
      rawBody: options.rawBody,
      origin: options.origin,
      headers,
    })
  )
}

function postWithoutContentType(options: { body?: unknown; origin?: string | null }) {
  const origin = options.origin === undefined ? new URL(loginUrl).origin : options.origin
  const headers: Record<string, string> = {}
  if (origin !== null) headers.origin = origin
  return POST(
    new Request(loginUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body ?? { username: adminUsername, password: adminPassword }),
    })
  )
}

describe('POST /api/admin/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'))
    setAdminEnv()
    setupFake()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('rifiuta con 403 quando manca l\'header Origin', async () => {
    const response = await postLogin({ origin: null })

    expect(response.status).toBe(403)
    expect(fake.inserts).toHaveLength(0)
  })

  it('rifiuta con 403 quando l\'Origin è diversa da quella della richiesta', async () => {
    const response = await postLogin({ origin: 'https://attacker.example' })

    expect(response.status).toBe(403)
    expect(fake.inserts).toHaveLength(0)
  })

  it('rifiuta con 415 quando il content-type non è JSON', async () => {
    const response = await postLogin({ contentType: null })

    expect(response.status).toBe(415)
    expect(fake.inserts).toHaveLength(0)
  })

  it('rifiuta con 400 un body JSON malformato senza scrivere audit', async () => {
    const response = await POST(
      adminRequest({ url: loginUrl, method: 'POST', rawBody: '{ non-json', headers: { 'x-real-ip': '10.0.0.1' } })
    )

    expect(response.status).toBe(400)
    expect(fake.inserts).toHaveLength(0)
  })

  it.each([
    ['username vuoto', { username: '   ', password: adminPassword }],
    ['password vuota', { username: adminUsername, password: '' }],
    ['entrambi assenti', {}],
  ])('rifiuta con 400 quando %s', async (_label, body) => {
    const response = await postLogin({ body })

    expect(response.status).toBe(400)
    expect(fake.inserts).toHaveLength(0)
  })

  it('risponde 401 e scrive l\'audit admin_login_failed con IP da x-real-ip', async () => {
    const response = await postLogin({ body: { username: adminUsername, password: 'wrong-password' }, ip: '203.0.113.9' })

    expect(response.status).toBe(401)
    const audit = fake.inserts.find((entry) => entry.values.action === 'admin_login_failed')
    expect(audit?.values).toMatchObject({
      action: 'admin_login_failed',
      resource_id: adminUsername,
      ip_address: '203.0.113.9',
    })
  })

  it('risponde 429 con audit admin_login_rate_limited quando l\'IP ha già 5 fallimenti', async () => {
    const requestIp = '203.0.113.9'
    const sinceIso = '2026-06-09T23:45:00.000Z'
    // Solo il filtro IP corretto dentro la finestra dei 15 minuti raggiunge la soglia.
    fake.setCountResolver(({ filters }) => (
      filters.ip_address === requestIp && filters['gte:created_at'] === sinceIso ? 5 : 0
    ))

    const response = await postLogin({ ip: requestIp })

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ errorType: 'forbidden' })
    expect(fake.reads).toContainEqual({
      table: 'audit_logs',
      filters: { action: 'admin_login_failed', ip_address: requestIp, 'gte:created_at': sinceIso },
    })
    expect(fake.inserts.find((entry) => entry.values.action === 'admin_login_rate_limited')).toBeTruthy()
    expect(fake.inserts.find((entry) => entry.values.action === 'admin_login_success')).toBeUndefined()
  })

  it('risponde 500 senza dettagli se il conteggio tentativi fallisce', async () => {
    fake.setSelectError({ message: 'connessione persa: password=segreta' })

    const response = await postLogin()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('segreta')
    expect(body.error).toBe('Errore interno')
  })

  it('risponde 200, scrive admin_login_success e imposta un cookie di sessione valido', async () => {
    const response = await postLogin({ ip: '203.0.113.9' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })

    const audit = fake.inserts.find((entry) => entry.values.action === 'admin_login_success')
    expect(audit?.values).toMatchObject({ action: 'admin_login_success', resource_id: adminUsername, ip_address: '203.0.113.9' })

    const cookie = setCookieHeader(response)
    expect(cookie).toContain(`${adminSessionCookieName}=`)
    const value = decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='))
    expect(readAdminSessionFromCookieValue(value)).toEqual({ username: adminUsername })
  })

  it('imposta gli attributi difensivi del cookie (httpOnly, sameSite strict, path, maxAge 12h) senza secure fuori produzione', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const response = await postLogin()

    const cookie = setCookieHeader(response)
    expect(cookie).toContain('HttpOnly')
    expect(cookie.toLowerCase()).toContain('samesite=strict')
    expect(cookie.toLowerCase()).toContain('path=/')
    expect(cookie.toLowerCase()).toContain('max-age=43200')
    expect(cookie.toLowerCase()).not.toContain('secure')
  })

  it('imposta secure solo quando NODE_ENV è production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await postLogin()

    expect(setCookieHeader(response).toLowerCase()).toContain('secure')
  })

  it('non emette cookie quando le credenziali sono errate', async () => {
    const response = await postLogin({ body: { username: adminUsername, password: 'wrong-password' } })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('accetta un cookie di sessione creato in precedenza (round-trip sessione)', async () => {
    // Guardia di coerenza: il cookie emesso al login è accettato dal lettore di sessione.
    expect(readAdminSessionFromCookieValue(validAdminSessionCookie())).toEqual({ username: adminUsername })
  })
})
