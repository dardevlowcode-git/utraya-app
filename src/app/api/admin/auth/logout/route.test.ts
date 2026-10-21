/* Commento didattico:
 * Scopo del file: verifica che il logout super-admin azzeri il cookie di sessione.
 * Moduli richiamati: route `admin/auth/logout` reale, `@/lib/auth/admin` reale per il nome del cookie.
 * Flusso: invoca il POST reale e controlla che il `set-cookie` azzeri valore, scadenza e attributi.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { adminRequest, adminSessionCookieName } from '@/__tests__/admin-route-helpers'
import { POST } from '@/app/api/admin/auth/logout/route'

const logoutUrl = 'https://utraya.com/api/admin/auth/logout'

function logout() {
  return POST(adminRequest({ url: logoutUrl, method: 'POST' }))
}

describe('POST /api/admin/auth/logout', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('azzera il cookie di sessione con valore vuoto e maxAge 0', async () => {
    const response = await logout()

    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${adminSessionCookieName}=;`)
    expect(cookie.toLowerCase()).toContain('max-age=0')
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('samesite=strict')
    expect(cookie.toLowerCase()).toContain('path=/')
  })

  it('rifiuta con 403 quando l\'Origin è diversa', async () => {
    const response = await POST(adminRequest({ url: logoutUrl, method: 'POST', origin: 'https://attacker.example' }))

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})