/* Commento didattico:
 * Scopo del file: verifica la route Bearer per registrare accettazioni legali versionate.
 * Moduli richiamati: handler HTTP, auth API e service legal acceptance simulati.
 * Flusso: invoca POST reale e controlla il rifiuto input/auth e l’identità passata al service.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiUserContext } from '@/lib/auth/apiUser'

const { getApiUserMock, recordLegalAcceptanceMock } = vi.hoisted(() => ({
  getApiUserMock: vi.fn(),
  recordLegalAcceptanceMock: vi.fn(),
}))

vi.mock('@/lib/auth/apiUser', () => ({ getApiUser: getApiUserMock }))
vi.mock('@/lib/services/legal-acceptance', () => ({ recordLegalAcceptance: recordLegalAcceptanceMock }))

import { POST } from './route'

function apiUser(userId = 'token-user'): ApiUserContext {
  return { user: { id: userId, email: 'token@example.test' }, supabase: {} } as unknown as ApiUserContext
}

function request(body: unknown) {
  return POST(new Request('http://localhost/api/v1/legal/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('POST /api/v1/legal/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiUserMock.mockResolvedValue(apiUser())
  })

  it('rifiuta il token anonimo senza registrare accettazioni', async () => {
    getApiUserMock.mockResolvedValue(null)

    expect((await request({ kinds: ['tos'] })).status).toBe(401)
    expect(recordLegalAcceptanceMock).not.toHaveBeenCalled()
  })

  it.each([
    ['versione non corrente', { kinds: ['tos'], version: 'obsolete-version' }],
    ['hash non corrente', { kinds: ['tos'], hash: 'sha256:obsolete' }],
  ])('rifiuta la %s senza scrivere', async (_case, body) => {
    expect((await request(body)).status).toBe(400)
    expect(recordLegalAcceptanceMock).not.toHaveBeenCalled()
  })

  it('registra l’accettazione con l’utente del token', async () => {
    const response = await request({ kinds: ['tos', 'tos_vexatorious'], locale: 'en' })

    expect(response.status).toBe(200)
    expect(recordLegalAcceptanceMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'token-user',
      userEmail: 'token@example.test',
      kinds: ['tos', 'tos_vexatorious'],
      locale: 'en',
    }))
  })
})
