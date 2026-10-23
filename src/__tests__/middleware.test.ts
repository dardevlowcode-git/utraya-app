/* Commento didattico:
 * Scopo del file: verifica il middleware reale (`src/middleware.ts`) su sessione admin, pagine private, rotte di bypass e security header.
 * Moduli richiamati: `vitest`, `next/server`, `@/middleware`, `@/lib/auth/admin` (firma del cookie admin), fake condiviso `@supabase/ssr`.
 * Flusso: costruisce una `NextRequest` con cookie finti e osserva redirect, status, cookie azzerati e header di sicurezza.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { adminSessionCookieName, adminUsername, setAdminEnv } from '@/__tests__/admin-route-helpers'
import { createSupabaseSsrFake } from '@/__tests__/helpers/supabaseSsrFake'

const getUserMock = vi.fn()
const rpcMock = vi.fn()
const maybeSingleMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => createSupabaseSsrFake({ getUserMock, rpcMock, maybeSingleMock, fromMock })) }))

const { middleware, config } = await import('@/middleware')
const { buildAdminSessionCookieValue } = await import('@/lib/auth/admin')

function request(path: string, init?: { cookies?: Record<string, string>; url?: string }) {
  const cookieHeader = Object.entries(init?.cookies ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
  return new NextRequest(init?.url ?? `https://utraya.com${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  })
}

function signedAdminCookie(username = adminUsername) {
  return buildAdminSessionCookieValue(username)
}

function expectSecurityHeaders(response: { headers: Headers }) {
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  expect(response.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()')
  expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
}

describe('middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setAdminEnv({ SUPERADMIN_PASSWORD_HASH: 'scrypt$16384$8$1$64$c2FsdA==$aGFzaA==' })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    getUserMock.mockResolvedValue({ data: { user: null } })
    rpcMock.mockResolvedValue({ data: true, error: null })
    maybeSingleMock.mockResolvedValue({ data: { id: 'user-1' }, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  describe('rotte admin con sessione admin', () => {
    it('reindirizza /admin/* senza cookie a /admin/login con redirectTo', async () => {
      const response = await middleware(request('/admin/users'))

      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location')!)
      expect(location.pathname).toBe('/admin/login')
      expect(location.searchParams.get('redirectTo')).toBe('/admin/users')
      expect(response.cookies.get(adminSessionCookieName)).toBeUndefined()
      expectSecurityHeaders(response)
    })

    it('reindirizza /admin/* con cookie manomesso e azzera cf_admin_session', async () => {
      const response = await middleware(request('/admin/allowlist', { cookies: { [adminSessionCookieName]: 'payload.firma-falsa' } }))

      expect(response.status).toBe(307)
      expect(new URL(response.headers.get('location')!).pathname).toBe('/admin/login')
      const cleared = response.cookies.get(adminSessionCookieName)
      expect(cleared).toBeDefined()
      expect(cleared?.value).toBe('')
      expect(cleared?.maxAge).toBe(0)
      expectSecurityHeaders(response)
    })

    it('reindirizza /admin/* con cookie scaduto e azzera cf_admin_session', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      const scaduto = signedAdminCookie()
      vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'))

      const response = await middleware(request('/admin/users', { cookies: { [adminSessionCookieName]: scaduto } }))

      expect(response.status).toBe(307)
      expect(new URL(response.headers.get('location')!).pathname).toBe('/admin/login')
      expect(response.cookies.get(adminSessionCookieName)?.value).toBe('')
    })

    it('lascia passare /admin/* con un cookie firmato valido', async () => {
      const response = await middleware(request('/admin/users', { cookies: { [adminSessionCookieName]: signedAdminCookie() } }))

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
      expectSecurityHeaders(response)
    })

    it('lascia passare /api/admin/* con un cookie firmato valido', async () => {
      const response = await middleware(request('/api/admin/allowlist', { cookies: { [adminSessionCookieName]: signedAdminCookie() } }))

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    })
  })

  describe('rotte /api/admin/* senza sessione', () => {
    it('risponde 401 JSON senza sessione valida', async () => {
      const response = await middleware(request('/api/admin/allowlist'))

      expect(response.status).toBe(401)
      expect(response.headers.get('content-type')).toContain('application/json')
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
      expectSecurityHeaders(response)
    })

    it('risponde 401 e azzera cf_admin_session con cookie invalido', async () => {
      const response = await middleware(request('/api/admin/allowlist', { cookies: { [adminSessionCookieName]: 'bad.value' } }))

      expect(response.status).toBe(401)
      expect(response.cookies.get(adminSessionCookieName)?.value).toBe('')
    })

    it('risponde 401 con una secret diversa da quella che ha firmato il cookie', async () => {
      const cookie = signedAdminCookie()
      vi.stubEnv('SUPERADMIN_SESSION_SECRET', 'test-secret-other-9876543210')

      const response = await middleware(request('/api/admin/allowlist', { cookies: { [adminSessionCookieName]: cookie } }))

      expect(response.status).toBe(401)
    })
  })

  describe('pagine private', () => {
    it('reindirizza l\'anonimo a /login con redirectTo', async () => {
      const response = await middleware(request('/dashboard'))

      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location')!)
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('redirectTo')).toBe('/dashboard')
      expectSecurityHeaders(response)
    })

    it('reindirizza a /login?error=access_denied se l\'utente non è in allowlist', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'utente@example.com' } } })
      rpcMock.mockResolvedValue({ data: false, error: null })

      const response = await middleware(request('/dashboard'))

      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location')!)
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('error')).toBe('access_denied')
    })

    it('reindirizza a /login?error=access_denied se la RPC fallisce', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'utente@example.com' } } })
      rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc down' } })

      const response = await middleware(request('/dashboard'))

      expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('access_denied')
    })

    it('reindirizza a /login?error=account_inactive e azzera i cookie sb-*', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'utente@example.com' } } })
      rpcMock.mockResolvedValue({ data: true, error: null })
      maybeSingleMock.mockResolvedValue({ data: null, error: null })

      const response = await middleware(
        request('/dashboard', { cookies: { 'sb-auth-token': 'sessione-finta', 'altro-cookie': 'x' } })
      )

      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location')!)
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('error')).toBe('account_inactive')
      expect(response.cookies.get('sb-auth-token')?.value).toBe('')
      expect(response.cookies.get('altro-cookie')).toBeUndefined()
    })

    it('lascia passare un utente allowlisted e attivo', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'utente@example.com' } } })

      const response = await middleware(request('/dashboard'))

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
      expectSecurityHeaders(response)
    })
  })

  describe('rotte di bypass', () => {
    it.each([
      '/api/v1/me',
      '/api/cron/daily-sync',
      '/api/internal/api-verifier',
      '/api/admin/auth/login',
      '/api/account/cancel-deletion',
      '/prezzi',
      '/legal/privacy',
    ])('non reindirizza %s per un anonimo', async (path) => {
      const response = await middleware(request(path))

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
      expectSecurityHeaders(response)
    })

    it('/api/cron/* è raggiungibile senza redirect (caso conservato)', async () => {
      const response = await middleware(request('/api/cron/daily-sync'))

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    })

    it('/legal/accept è invece protetta', async () => {
      const response = await middleware(request('/legal/accept'))

      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location')!)
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('redirectTo')).toBe('/legal/accept')
    })
  })

  describe('redirect di / e /login per utente valido', () => {
    it.each(['/', '/login'])('reindirizza %s a /dashboard per utente allowlisted e attivo', async (path) => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'utente@example.com' } } })

      const response = await middleware(request(path))

      expect(response.status).toBe(307)
      expect(new URL(response.headers.get('location')!).pathname).toBe('/dashboard')
    })

    it('non reindirizza /login se l\'utente non è allowlisted', async () => {
      getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'utente@example.com' } } })
      rpcMock.mockResolvedValue({ data: false, error: null })

      const response = await middleware(request('/login'))

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    })
  })

  describe('config.matcher', () => {
    it('esclude asset statici e percorsi che finiscono con un\'estensione immagine', () => {
      const matcher = new RegExp(`^${config.matcher[0]}$`)

      // Percorsi gestiti dal middleware.
      expect(matcher.test('/dashboard')).toBe(true)
      expect(matcher.test('/admin/users')).toBe(true)
      expect(matcher.test('/api/admin/allowlist')).toBe(true)

      // Esclusi: asset interni Next e file con estensione immagine.
      expect(matcher.test('/_next/static/chunk.js')).toBe(false)
      expect(matcher.test('/_next/image')).toBe(false)
      expect(matcher.test('/favicon.ico')).toBe(false)
      expect(matcher.test('/video/demo.png')).toBe(false)
      expect(matcher.test('/video/demo.svg')).toBe(false)
    })
  })
})
