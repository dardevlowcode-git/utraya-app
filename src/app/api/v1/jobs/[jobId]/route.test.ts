/* Commento didattico:
 * Scopo del file: testa ownership e contratto della route v1 stato job senza database.
 * Moduli richiamati: route `v1/jobs/[jobId]`, auth e service mockati, `vitest`.
 * Flusso: simula Bearer user e service per happy-path, 404, 403 ownership e validazione.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/utils/errors'
import type { ApiUserContext } from '@/lib/auth/apiUser'

const { getApiUserMock, getUserJobStatusMock } = vi.hoisted(() => ({
  getApiUserMock: vi.fn(),
  getUserJobStatusMock: vi.fn(),
}))

vi.mock('@/lib/auth/apiUser', () => ({
  getApiUser: getApiUserMock,
}))

vi.mock('@/lib/services/user-jobs', () => ({
  getUserJobStatus: getUserJobStatusMock,
}))

// Import statico dopo i mock: vitest solleva le factory prima dell'import.
import { GET } from '@/app/api/v1/jobs/[jobId]/route'

const JOB_UUID = '123e4567-e89b-12d3-a456-426614174001'

function authedUser(): ApiUserContext {
  return {
    user: { id: 'user-1', email: 'user1@example.com' },
    supabase: {},
  } as unknown as ApiUserContext
}

function jobRequest(jobId: string) {
  return new Request(`http://localhost/api/v1/jobs/${jobId}`)
}

function jobContext(jobId: string) {
  return { params: Promise.resolve({ jobId }) }
}

describe('GET /api/v1/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiUserMock.mockResolvedValue(authedUser())
  })

  it('restituisce lo stato del job di proprieta`', async () => {
    getUserJobStatusMock.mockResolvedValue({ id: JOB_UUID, type: 'sync_channel_delta', status: 'completed' })
    const response = await GET(jobRequest(JOB_UUID), jobContext(JOB_UUID))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { ok: boolean; data: { status: string }; requestId: string }
    expect(payload.data.status).toBe('completed')
    expect(getUserJobStatusMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', jobId: JOB_UUID }))
  })

  it('nasconde i job di altri utenti con 404', async () => {
    getUserJobStatusMock.mockRejectedValue(new AppError('Job non trovato', 'not_found', 404))
    const response = await GET(jobRequest(JOB_UUID), jobContext(JOB_UUID))
    expect(response.status).toBe(404)
    const payload = (await response.json()) as { error: { code: string } }
    expect(payload.error.code).toBe('NOT_FOUND')
  })

  it('valida il formato jobId', async () => {
    const response = await GET(jobRequest('non-uuid'), jobContext('non-uuid'))
    expect(response.status).toBe(400)
  })

  it('rifiuta senza Bearer con 401', async () => {
    getApiUserMock.mockResolvedValue(null)
    const response = await GET(jobRequest(JOB_UUID), jobContext(JOB_UUID))
    expect(response.status).toBe(401)
  })
})
