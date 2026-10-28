import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getApiUserMock, getDeletionRequestViewMock, requestDeletionMock } = vi.hoisted(() => ({
  getApiUserMock: vi.fn(),
  getDeletionRequestViewMock: vi.fn(),
  requestDeletionMock: vi.fn(),
}))

vi.mock('@/lib/auth/apiUser', () => ({ getApiUser: getApiUserMock }))
vi.mock('@/lib/services/account-deletion', () => ({
  getDeletionRequestView: getDeletionRequestViewMock,
  requestDeletion: requestDeletionMock,
}))

import { DELETE, GET } from './route'

describe('/api/v1/account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'person@example.test' }, supabase: {} })
    getDeletionRequestViewMock.mockResolvedValue({
      status: 'pending',
      scheduledFor: '2026-11-01T00:00:00.000Z',
      requestedAt: '2026-10-01T00:00:00.000Z',
      canCancel: true,
      daysRemaining: 10,
      cancelToken: 'test-cancel-token',
    })
  })

  it('rifiuta anonimi sia in lettura sia in richiesta cancellazione', async () => {
    getApiUserMock.mockResolvedValue(null)

    expect((await GET(new Request('http://localhost/api/v1/account'))).status).toBe(401)
    expect((await DELETE(new Request('http://localhost/api/v1/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'test' }),
    }))).status).toBe(401)
    expect(getDeletionRequestViewMock).not.toHaveBeenCalled()
    expect(requestDeletionMock).not.toHaveBeenCalled()
  })

  it('restituisce esclusivamente i campi del view model di cancellazione', async () => {
    const response = await GET(new Request('http://localhost/api/v1/account'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toEqual({
      status: 'pending',
      scheduledFor: '2026-11-01T00:00:00.000Z',
      requestedAt: '2026-10-01T00:00:00.000Z',
      canCancel: true,
      daysRemaining: 10,
      cancelToken: 'test-cancel-token',
    })
  })
})
