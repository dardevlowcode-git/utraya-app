/* Commento didattico:
 * Scopo del file: middleware globale per auth, route pubbliche, admin session e security headers.
 * Moduli richiamati: `@supabase/ssr`, `next/server`, allowlist helper.
 * Flusso: decide se lasciare passare, redirigere o bloccare richieste in base a sessione, ruolo e percorso.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isEmailAllowlisted } from '@/lib/auth/allowlist'

const adminSessionCookieName = 'cf_admin_session'
const textEncoder = new TextEncoder()
const publicMarketingRoutes = new Set([
  '/',
  '/funzionalita',
  '/prezzi',
  '/faq',
  '/comparazioni',
  '/roadmap',
  '/mission',
  '/chi-siamo',
  '/prodotto',
  '/progetto',
  '/legale',
  '/termini-di-servizio',
  '/privacy-policy',
  '/cookie-policy',
  '/legal',
  '/legal/termini',
  '/legal/privacy',
  '/legal/cookie',
  '/legal/sub-processors',
])

function isPublicMarketingRoute(pathname: string): boolean {
  if (pathname === '/legal/accept') {
    return false
  }
  return publicMarketingRoutes.has(pathname) || pathname.startsWith('/legal/')
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  return response
}

function decodeBase64Url(input: string): Uint8Array | null {
  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

async function verifyAdminSessionCookie(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false
  const secret = process.env.SUPERADMIN_SESSION_SECRET?.trim()
  if (!secret) return false

  const [payload, signature] = cookieValue.split('.')
  if (!payload || !signature) return false

  const payloadBytes = textEncoder.encode(payload)
  const signatureBytes = decodeBase64Url(signature)
  if (!signatureBytes) return false

  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const validSignature = await crypto.subtle.verify('HMAC', key, signatureBytes as unknown as BufferSource, payloadBytes as unknown as BufferSource)
  if (!validSignature) return false

  const payloadDecoded = decodeBase64Url(payload)
  if (!payloadDecoded) return false

  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadDecoded)) as { exp?: number }
    return typeof parsed.exp === 'number' && Date.now() <= parsed.exp
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = applySecurityHeaders(NextResponse.next({ request }))

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = applySecurityHeaders(NextResponse.next({ request }))
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const adminSessionCookie = request.cookies.get(adminSessionCookieName)?.value
  const hasValidAdminSession = await verifyAdminSessionCookie(adminSessionCookie)

  if (
    isPublicMarketingRoute(pathname) ||
    pathname === '/login' ||
    pathname === '/admin/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/admin/auth/') ||
    pathname.startsWith('/api/account/cancel-deletion') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    if ((pathname === '/login' || pathname === '/') && user?.email) {
      const allowlisted = await isEmailAllowlisted(user.email)
      if (allowlisted) {
        const { data: appUser } = await supabase
          .from('users')
          .select('id')
          .eq('id', user.id)
          .eq('status', 'active')
          .maybeSingle()

        if (appUser) {
          return applySecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)))
        }
      }
    }

    return supabaseResponse
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!hasValidAdminSession) {
      const response = applySecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      if (adminSessionCookie) {
        response.cookies.set({ name: adminSessionCookieName, value: '', path: '/', maxAge: 0 })
      }
      return response
    }
    return supabaseResponse
  }

  if (pathname.startsWith('/admin')) {
    if (!hasValidAdminSession) {
      if (adminSessionCookie) {
        const response = applySecurityHeaders(NextResponse.redirect(new URL('/admin/login', request.url)))
        response.cookies.set({ name: adminSessionCookieName, value: '', path: '/', maxAge: 0 })
        return response
      }

      const adminLoginUrl = new URL('/admin/login', request.url)
      adminLoginUrl.searchParams.set('redirectTo', pathname)
      return applySecurityHeaders(NextResponse.redirect(adminLoginUrl))
    }
    return supabaseResponse
  }

  if (!user || !user.email) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return applySecurityHeaders(NextResponse.redirect(loginUrl))
  }

  const isAllowlisted = await isEmailAllowlisted(user.email)
  if (!isAllowlisted) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', 'access_denied')
    return applySecurityHeaders(NextResponse.redirect(loginUrl))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
