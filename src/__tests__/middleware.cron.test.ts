/* Commento didattico:
 * Scopo del file: evita regressioni sul middleware verificando che gli endpoint cron restino raggiungibili senza redirect login.
 * Moduli richiamati: `vitest`, `next/server`, `@/middleware`, mock `@supabase/ssr`.
 * Flusso: simula richiesta anonima su `/api/cron/*` e valida risposta pass-through (`200`, no redirect).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getUserMock = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
    },
  })),
}))

vi.mock('@/lib/auth/allowlist', () => ({
  isEmailAllowlisted: vi.fn(async () => false),
}))

describe('middleware cron bypass', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getUserMock.mockResolvedValue({ data: { user: null } })
  })

  it('non reindirizza a /login le route /api/cron/*', async () => {
    const request = new NextRequest('https://utraya.com/api/cron/daily-sync')
    const { middleware } = await import('@/middleware')
    const response = await middleware(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
})
