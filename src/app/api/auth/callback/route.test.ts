/* Commento didattico:
 * Scopo del file: verifica callback OAuth su redirect safe, uso NEXT_PUBLIC_SITE_URL, gating TOS e blocco account in cancellazione.
 * Moduli richiamati: route callback, mock supabase/allowlist/legal/deletion.
 * Flusso: isola la route con mock e valida i redirect risultanti in scenari sicurezza e business critici.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeCodeForSessionMock = vi.fn()
const getUserMock = vi.fn()
const signOutMock = vi.fn()
const isEmailAllowlistedMock = vi.fn()
const provisionNewUserMock = vi.fn()
const getLegalAcceptanceStatusMock = vi.fn()
const isDeletionPendingMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: exchangeCodeForSessionMock,
      getUser: getUserMock,
      signOut: signOutMock,
    },
  })),
}))

vi.mock('@/lib/auth/allowlist', () => ({
  isEmailAllowlisted: isEmailAllowlistedMock,
  provisionNewUser: provisionNewUserMock,
}))

vi.mock('@/lib/services/legal-acceptance', () => ({
  getLegalAcceptanceStatus: getLegalAcceptanceStatusMock,
}))

vi.mock('@/lib/services/account-deletion', () => ({
  isDeletionPending: isDeletionPendingMock,
}))

let GET: typeof import('@/app/api/auth/callback/route').GET

function callbackRequest(url: string): Request {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/auth/callback', () => {
  beforeAll(async () => {
    ;({ GET } = await import('@/app/api/auth/callback/route'))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.utraya.test')

    exchangeCodeForSessionMock.mockResolvedValue({ error: null })
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'user@example.com',
          user_metadata: {},
          identities: [{ provider: 'google', id: 'identity-1' }],
        },
      },
    })
    isEmailAllowlistedMock.mockResolvedValue(true)
    isDeletionPendingMock.mockResolvedValue(false)
    provisionNewUserMock.mockResolvedValue({ success: true, user: { id: 'user-1' } })
    getLegalAcceptanceStatusMock.mockResolvedValue({ needsAcceptance: false })
  })

  it('ignora Host/X-Forwarded-Host e usa NEXT_PUBLIC_SITE_URL nel redirect', async () => {
    const response = await GET(callbackRequest('https://evil.test/api/auth/callback?code=abc') as never)
    expect(response.headers.get('location')).toBe('https://app.utraya.test/dashboard')
  })

  it('blocca redirect assoluti malevoli', async () => {
    const response = await GET(
      callbackRequest('https://app.utraya.test/api/auth/callback?code=abc&redirectTo=https%3A%2F%2Fevil.test%2Fpwn') as never
    )
    expect(response.headers.get('location')).toBe('https://app.utraya.test/dashboard')
  })

  it('blocca redirect protocol-relative malevoli', async () => {
    const response = await GET(
      callbackRequest('https://app.utraya.test/api/auth/callback?code=abc&redirectTo=%2F%2Fevil.test%2Fpwn') as never
    )
    expect(response.headers.get('location')).toBe('https://app.utraya.test/dashboard')
  })

  it('accetta solo path relativi interni', async () => {
    const response = await GET(
      callbackRequest('https://app.utraya.test/api/auth/callback?code=abc&redirectTo=%2Fdashboard%3Ftab%3Dchannels') as never
    )
    expect(response.headers.get('location')).toBe('https://app.utraya.test/dashboard?tab=channels')
  })

  it('reindirizza a /legal/accept quando manca accettazione TOS', async () => {
    getLegalAcceptanceStatusMock.mockResolvedValue({ needsAcceptance: true })
    const response = await GET(callbackRequest('https://app.utraya.test/api/auth/callback?code=abc') as never)
    expect(response.headers.get('location')).toBe('https://app.utraya.test/legal/accept')
  })

  it('blocca login se account in pending deletion', async () => {
    isDeletionPendingMock.mockResolvedValue(true)
    const response = await GET(callbackRequest('https://app.utraya.test/api/auth/callback?code=abc') as never)
    expect(response.headers.get('location')).toBe('https://app.utraya.test/login?error=deletion_pending')
  })
})