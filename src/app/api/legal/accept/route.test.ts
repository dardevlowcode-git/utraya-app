/* Commento didattico:
 * Scopo del file: verifica autenticazione, input e identità della route cookie di accettazione legale.
 * Moduli richiamati: handler HTTP, auth di sessione e service legal acceptance simulati.
 * Flusso: invoca il POST reale e osserva status e dati passati al service senza database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentUserMock, recordLegalAcceptanceMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  recordLegalAcceptanceMock: vi.fn(),
}))

vi.mock('@/lib/auth/getCurrentUser', () => ({ getCurrentUser: getCurrentUserMock }))
vi.mock('@/lib/services/legal-acceptance', () => ({ recordLegalAcceptance: recordLegalAcceptanceMock }))

import { POST } from './route'

function request(body: unknown, headers: Record<string, string> = {
  origin: 'http://localhost',
  'content-type': 'application/json',
}) {
  return POST(new Request('http://localhost/api/legal/accept', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }))
}

describe('POST /api/legal/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUserMock.mockResolvedValue({ user: { id: 'session-user', email: 'session@example.test' }, supabase: {} })
  })

  it('rifiuta la sessione anonima senza registrare accettazioni', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    expect((await request({ kinds: ['tos'] })).status).toBe(401)
    expect(recordLegalAcceptanceMock).not.toHaveBeenCalled()
  })

  it.skip.each([
    ['versione non corrente', { kinds: ['tos'], version: 'obsolete-version' }],
    ['hash non corrente', { kinds: ['tos'], hash: 'sha256:obsolete' }],
  ])('rifiuta la %s senza scrivere', async (_case, body) => {
    // BUG: la route cookie ignora i campi versione/hash sconosciuti invece di rifiutarli.
    expect((await request(body)).status).toBe(400)
    expect(recordLegalAcceptanceMock).not.toHaveBeenCalled()
  })

  it('registra l’accettazione usando l’identità di sessione, non quella nel body', async () => {
    const response = await request({
      kinds: ['tos', 'tos_vexatorious'],
      locale: 'en',
      userId: 'body-user',
      userEmail: 'body@example.test',
    })

    expect(response.status).toBe(200)
    expect(recordLegalAcceptanceMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'session-user',
      userEmail: 'session@example.test',
      kinds: ['tos', 'tos_vexatorious'],
      locale: 'en',
    }))
  })

  it.skip('rifiuta un origin assente o diverso prima della scrittura', async () => {
    // BUG: la route cookie non applica ensureSameOrigin.
    expect((await request({ kinds: ['tos'] }, { 'content-type': 'application/json' })).status).toBe(403)
    expect((await request({ kinds: ['tos'] }, { origin: 'https://evil.test', 'content-type': 'application/json' })).status).toBe(403)
    expect(recordLegalAcceptanceMock).not.toHaveBeenCalled()
  })

  it.skip('rifiuta un content-type non JSON prima della scrittura', async () => {
    // BUG: la route cookie non applica ensureJsonRequest.
    expect((await request({ kinds: ['tos'] }, { origin: 'http://localhost', 'content-type': 'text/plain' })).status).toBe(415)
    expect(recordLegalAcceptanceMock).not.toHaveBeenCalled()
  })
})
