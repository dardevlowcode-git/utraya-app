/* Commento didattico:
 * Scopo del file: testa i flussi principali del service account deletion (token, request, cancel, execute, force delete).
 * Moduli richiamati: service account-deletion con mock Supabase admin e builder URL.
 * Flusso: valida i path critici senza accesso DB reale, verificando query/rpc invocate correttamente.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDeletion,
  createCancelDeletionToken,
  executeDeletion,
  forceDeleteUser,
  requestDeletion,
} from '@/lib/services/account-deletion'

const { createAdminClientMock, buildSiteUrlMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  buildSiteUrlMock: vi.fn((path: string) => `https://site.test${path}`),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/lib/env/getSiteUrl', () => ({
  buildSiteUrl: buildSiteUrlMock,
}))

describe('account-deletion service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPERADMIN_SESSION_SECRET', 'test-superadmin-session-secret')
  })

  it('requestDeletion riusa richiesta pending esistente e genera cancelUrl', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'req-existing', scheduled_deletion_at: '2026-06-16T10:00:00.000Z' },
      error: null,
    })
    const eqStatusMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
    const eqUserMock = vi.fn(() => ({ eq: eqStatusMock }))
    const selectMock = vi.fn(() => ({ eq: eqUserMock }))
    const fromMock = vi.fn((table: string) => {
      if (table === 'user_deletion_requests') return { select: selectMock }
      return { insert: vi.fn() }
    })

    createAdminClientMock.mockReturnValue({ from: fromMock })

    const result = await requestDeletion({
      userId: 'user-1',
      userEmail: 'user1@example.com',
      reason: null,
      ipAddress: null,
      userAgent: 'vitest',
    })

    expect(result.scheduledFor).toBe('2026-06-16T10:00:00.000Z')
    expect(result.cancelUrl.startsWith('https://site.test/api/account/cancel-deletion?token=')).toBe(true)
  })

  it('createCancelDeletionToken e cancelDeletion aggiornano request/users con token valido', async () => {
    // Orologio finto: il token scade il 2026-06-20, quindi la verifica deve
    // avvenire "prima" di quella data, altrimenti Date.now() reale lo dichiara
    // scaduto e il test fallisce sempre. Non tocca il codice vero.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'))
      const requestUpdateEq3Mock = vi.fn().mockResolvedValue({ error: null })
      const requestUpdateEq2Mock = vi.fn(() => ({ eq: requestUpdateEq3Mock }))
      const requestUpdateEq1Mock = vi.fn(() => ({ eq: requestUpdateEq2Mock }))
      const requestUpdateMock = vi.fn(() => ({ eq: requestUpdateEq1Mock }))

      const usersUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
      const usersUpdateMock = vi.fn(() => ({ eq: usersUpdateEqMock }))

      const fromMock = vi.fn((table: string) => {
        if (table === 'user_deletion_requests') return { update: requestUpdateMock }
        if (table === 'users') return { update: usersUpdateMock }
        return { update: vi.fn() }
      })

      createAdminClientMock.mockReturnValue({ from: fromMock })

      const token = createCancelDeletionToken('user-2', 'req-2', '2026-06-20T00:00:00.000Z')
      await cancelDeletion(token)

      expect(requestUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
      expect(usersUpdateMock).toHaveBeenCalledWith({ status: 'active' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('executeDeletion invoca rpc di purge e marca richiesta completed', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'req-3', user_id: 'user-3', status: 'pending' },
      error: null,
    })
    const selectEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
    const selectMock = vi.fn(() => ({ eq: selectEqMock }))

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn(() => ({ eq: updateEqMock }))
    const rpcMock = vi.fn().mockResolvedValue({ error: null })

    const fromMock = vi.fn((table: string) => {
      if (table === 'user_deletion_requests') return { select: selectMock, update: updateMock }
      return { insert: vi.fn() }
    })
    createAdminClientMock.mockReturnValue({ from: fromMock, rpc: rpcMock })

    await executeDeletion('req-3')

    expect(rpcMock).toHaveBeenCalledWith('execute_user_deletion', { p_user_id: 'user-3' })
    expect(updateMock).toHaveBeenCalledTimes(2)
  })

  it('forceDeleteUser invoca rpc e registra audit log admin', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    const appLogsInsertMock = vi.fn().mockResolvedValue({ error: null })
    const fromMock = vi.fn((table: string) => {
      if (table === 'app_logs') return { insert: appLogsInsertMock }
      return { insert: vi.fn() }
    })
    createAdminClientMock.mockReturnValue({ from: fromMock, rpc: rpcMock })

    await forceDeleteUser('user-4', 'admin', 'gdpr request')

    expect(rpcMock).toHaveBeenCalledWith('execute_user_deletion', { p_user_id: 'user-4' })
    expect(appLogsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: 'force_delete_user',
      })
    )
  })
})
