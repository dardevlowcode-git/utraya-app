import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentUserMock, requestDeletionMock, signOutMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  requestDeletionMock: vi.fn(),
  signOutMock: vi.fn(),
}))

vi.mock('@/lib/auth/getCurrentUser', () => ({ getCurrentUser: getCurrentUserMock }))
vi.mock('@/lib/services/account-deletion', () => ({ requestDeletion: requestDeletionMock }))

import { DELETE } from './route'

function deleteRequest(body: unknown = {}) {
  return DELETE(new Request('http://localhost/api/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('DELETE /api/account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUserMock.mockResolvedValue({
      user: { id: 'session-user', email: 'session@example.test' },
      supabase: { auth: { signOut: signOutMock } },
    })
    requestDeletionMock.mockResolvedValue({
      scheduledFor: '2026-11-01T00:00:00.000Z',
      cancelUrl: 'https://app.test/cancel/test-token',
      internalUserId: 'must-not-be-returned',
    })
  })

  it('rifiuta la sessione anonima senza richiedere la cancellazione', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    expect((await deleteRequest()).status).toBe(401)
    expect(requestDeletionMock).not.toHaveBeenCalled()
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('usa l’utente della sessione e restituisce solo i campi pubblici previsti', async () => {
    const response = await deleteRequest({ reason: 'richiesta utente', userId: 'body-user' })
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(requestDeletionMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'session-user',
      userEmail: 'session@example.test',
      reason: 'richiesta utente',
    }))
    expect(payload.data).toEqual({
      scheduledFor: '2026-11-01T00:00:00.000Z',
      cancelUrl: 'https://app.test/cancel/test-token',
    })
    expect(signOutMock).toHaveBeenCalledOnce()
  })
})
