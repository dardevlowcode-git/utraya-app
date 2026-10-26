/* Commento didattico:
 * Scopo del file: verifica che il bootstrap utente v1 richieda Bearer e restituisca solo i view model pubblici.
 * Moduli richiamati: handler HTTP, auth Bearer e servizi legali/cancellazione simulati.
 * Flusso: chiama GET reale e confronta l’intera risposta dati con il contratto minimo atteso.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getApiUserMock, getDeletionRequestViewMock, getLegalAcceptanceStatusMock } = vi.hoisted(() => ({
  getApiUserMock: vi.fn(),
  getDeletionRequestViewMock: vi.fn(),
  getLegalAcceptanceStatusMock: vi.fn(),
}))

vi.mock('@/lib/auth/apiUser', () => ({ getApiUser: getApiUserMock }))
vi.mock('@/lib/services/account-deletion', () => ({ getDeletionRequestView: getDeletionRequestViewMock }))
vi.mock('@/lib/services/legal-acceptance', () => ({ getLegalAcceptanceStatus: getLegalAcceptanceStatusMock }))

import { GET } from './route'

describe('GET /api/v1/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiUserMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'person@example.test',
        created_at: '2026-01-02T03:04:05.000Z',
        role: 'admin',
        app_metadata: { provider: 'google', access_token: 'private-token' },
        user_metadata: { full_name: 'Person', private: true },
      },
      supabase: {},
    })
    getDeletionRequestViewMock.mockResolvedValue({
      status: 'none', scheduledFor: null, requestedAt: null, canCancel: false, daysRemaining: null, cancelToken: null,
    })
    getLegalAcceptanceStatusMock.mockResolvedValue({
      needsAcceptance: false,
      missing: [],
      tosVersion: '2026-10-25-1',
      tosHash: 'sha256:current-tos',
      tosVexVersion: '2026-05-16-1',
      tosVexHash: 'sha256:current-vex',
      privacyVersion: '2026-10-25-1',
      privacyHash: 'sha256:current-privacy',
      currentLocale: 'it',
    })
  })

  it('rifiuta il token anonimo senza caricare dati utente', async () => {
    getApiUserMock.mockResolvedValue(null)

    expect((await GET(new Request('http://localhost/api/v1/me'))).status).toBe(401)
    expect(getDeletionRequestViewMock).not.toHaveBeenCalled()
    expect(getLegalAcceptanceStatusMock).not.toHaveBeenCalled()
  })

  it('restituisce solo identità e view model pubblici, senza campi grezzi', async () => {
    const response = await GET(new Request('http://localhost/api/v1/me?locale=it'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toEqual({
      user: { id: 'user-1', email: 'person@example.test', createdAt: '2026-01-02T03:04:05.000Z' },
      legal: {
        needsAcceptance: false,
        missing: [],
        tosVersion: '2026-10-25-1',
        tosHash: 'sha256:current-tos',
        tosVexVersion: '2026-05-16-1',
        tosVexHash: 'sha256:current-vex',
        privacyVersion: '2026-10-25-1',
        privacyHash: 'sha256:current-privacy',
        currentLocale: 'it',
      },
      deletion: {
        status: 'none', scheduledFor: null, requestedAt: null, canCancel: false, daysRemaining: null, cancelToken: null,
      },
    })
  })
})
