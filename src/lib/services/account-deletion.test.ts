/* Commento didattico:
 * Scopo del file: testa i flussi principali del service account deletion (token, request, cancel, execute, force delete).
 * Moduli richiamati: service account-deletion reale con mock Supabase admin e builder URL.
 * Flusso: valida i path critici senza accesso DB reale, verificando query/rpc invocate e i casi avversi del token firmato.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDeletion,
  createCancelDeletionToken,
  executeDeletion,
  forceDeleteUser,
  getCancelDeletionTokenOwner,
  requestDeletion,
} from '@/lib/services/account-deletion'

const SECRET = 'test-account-deletion-secret'

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

/** Client admin finto con una sola RPC osservabile: nessun accesso DB reale. */
function rpcOnlyClient(rpcResult: { data?: unknown; error?: { message: string } | null } = { data: true, error: null }) {
  const rpcMock = vi.fn().mockResolvedValue(rpcResult)
  createAdminClientMock.mockReturnValue({ rpc: rpcMock })
  return rpcMock
}

/** Firma un payload arbitrario come farebbe il service, per provare i casi avversi. */
async function signedToken(payload: unknown, secret = SECRET): Promise<string> {
  const { createHmac } = await import('node:crypto')
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`
}

/** Payload di un token di annullamento ancora valido per l'orologio finto corrente. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    purpose: 'cancel_deletion',
    userId: 'user-2',
    requestId: 'req-2',
    exp: new Date('2026-06-20T00:00:00.000Z').getTime(),
    nonce: 'deadbeefdeadbeef',
    ...overrides,
  }
}

describe('account-deletion service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T00:00:00.000Z'))
    vi.stubEnv('ACCOUNT_DELETION_TOKEN_SECRET', SECRET)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
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

  it('createCancelDeletionToken e cancelDeletion usano la transizione atomica', async () => {
    const rpcMock = rpcOnlyClient({ data: true, error: null })

    const token = createCancelDeletionToken('user-2', 'req-2', '2026-06-20T00:00:00.000Z')
    await expect(cancelDeletion(token)).resolves.toBe(true)

    expect(rpcMock).toHaveBeenCalledWith('cancel_account_deletion', {
      p_user_id: 'user-2',
      p_request_id: 'req-2',
    })
  })

  it('lega il token all’utente e alla richiesta firmati, non a quelli del chiamante', async () => {
    const token = createCancelDeletionToken('user-owner', 'req-owner', '2026-06-20T00:00:00.000Z')

    expect(getCancelDeletionTokenOwner(token)).toBe('user-owner')

    const rpcMock = rpcOnlyClient({ data: true, error: null })
    await cancelDeletion(token)

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('cancel_account_deletion', {
      p_user_id: 'user-owner',
      p_request_id: 'req-owner',
    })
  })

  it('non riattiva l’utente quando la richiesta pending non esiste piu`', async () => {
    rpcOnlyClient({ data: false, error: null })

    const token = createCancelDeletionToken('user-2', 'req-expired', '2026-06-20T00:00:00.000Z')
    await expect(cancelDeletion(token)).resolves.toBe(false)
  })

  it('propaga l’errore della RPC di annullamento senza dichiarare il ripristino', async () => {
    rpcOnlyClient({ data: true, error: { message: 'rpc down' } })

    const token = createCancelDeletionToken('user-2', 'req-2', '2026-06-20T00:00:00.000Z')
    await expect(cancelDeletion(token)).rejects.toThrow('Errore annullamento cancellazione: rpc down')
  })

  it('non chiama alcuna RPC quando il token non e` firmato con il secret corrente', async () => {
    const rpcMock = rpcOnlyClient()
    const forged = await signedToken(validPayload(), 'test-altro-secret')

    await expect(cancelDeletion(forged)).rejects.toThrow('Token cancellazione non valido')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('non chiama alcuna RPC quando la firma e` manomessa', async () => {
    const rpcMock = rpcOnlyClient()
    const valid = createCancelDeletionToken('user-2', 'req-2', '2026-06-20T00:00:00.000Z')
    const [payload, signature] = valid.split('.')
    const tampered = `${payload}.${signature.slice(0, -2)}xx`

    await expect(cancelDeletion(tampered)).rejects.toThrow('Token cancellazione non valido')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('non chiama alcuna RPC quando il payload e` manomesso', async () => {
    const rpcMock = rpcOnlyClient()
    const otherPayload = Buffer.from(JSON.stringify(validPayload({ userId: 'user-vittima' })), 'utf8').toString('base64url')
    const valid = createCancelDeletionToken('user-2', 'req-2', '2026-06-20T00:00:00.000Z')
    const tampered = `${otherPayload}.${valid.split('.')[1]}`

    await expect(cancelDeletion(tampered)).rejects.toThrow('Token cancellazione non valido')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('non chiama alcuna RPC quando il token e` scaduto', async () => {
    const rpcMock = rpcOnlyClient()
    const expired = createCancelDeletionToken('user-2', 'req-2', '2026-06-09T23:59:59.000Z')

    await expect(cancelDeletion(expired)).rejects.toThrow('Token cancellazione scaduto')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('non chiama alcuna RPC quando lo scopo del token e` diverso', async () => {
    const rpcMock = rpcOnlyClient()
    const wrongPurpose = await signedToken(validPayload({ purpose: 'confirm_deletion' }))

    await expect(cancelDeletion(wrongPurpose)).rejects.toThrow('Token cancellazione malformato')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it.each([
    ['userId assente', { userId: undefined }],
    ['requestId assente', { requestId: undefined }],
    ['scadenza non numerica', { exp: 'domani' }],
  ])('non chiama alcuna RPC quando %s', async (_name, overrides) => {
    const rpcMock = rpcOnlyClient()
    const malformed = await signedToken(validPayload(overrides))

    await expect(cancelDeletion(malformed)).rejects.toThrow('Token cancellazione malformato')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('non chiama alcuna RPC quando il token e` malformato o vuoto', async () => {
    const rpcMock = rpcOnlyClient()

    for (const token of ['', 'solo-payload-senza-firma', 'payload.e']) {
      await expect(cancelDeletion(token)).rejects.toThrow('Token cancellazione non valido')
    }
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('non chiama alcuna RPC quando il payload firmato non e` JSON', async () => {
    const rpcMock = rpcOnlyClient()
    const { createHmac } = await import('node:crypto')
    const notJson = Buffer.from('non-json', 'utf8').toString('base64url')
    const signedNotJson = `${notJson}.${createHmac('sha256', SECRET).update(notJson).digest('base64url')}`

    await expect(cancelDeletion(signedNotJson)).rejects.toThrow('Token cancellazione non valido')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rifiuta la verifica del token e non emette token quando il secret manca', async () => {
    vi.stubEnv('ACCOUNT_DELETION_TOKEN_SECRET', '')
    const rpcMock = rpcOnlyClient()

    expect(() => createCancelDeletionToken('user-2', 'req-2', '2026-06-20T00:00:00.000Z')).toThrow(
      'ACCOUNT_DELETION_TOKEN_SECRET mancante per firma token cancellazione'
    )
    await expect(cancelDeletion('qualsiasi.token')).rejects.toThrow(
      'ACCOUNT_DELETION_TOKEN_SECRET mancante per firma token cancellazione'
    )
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('executeDeletion invoca rpc di purge e marca richiesta completed con payload di stato', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'req-3', user_id: 'user-3', status: 'pending' },
      error: null,
    })
    const selectEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
    const selectMock = vi.fn(() => ({ eq: selectEqMock }))

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn(() => ({ eq: updateEqMock }))
    const rpcMock = vi.fn((name: string) => {
      if (name === 'claim_account_deletion') return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const fromMock = vi.fn((table: string) => {
      if (table === 'user_deletion_requests') return { select: selectMock, update: updateMock }
      return { insert: vi.fn() }
    })
    createAdminClientMock.mockReturnValue({ from: fromMock, rpc: rpcMock })

    await executeDeletion('req-3')

    expect(rpcMock).toHaveBeenCalledWith('claim_account_deletion', { p_request_id: 'req-3' })
    expect(rpcMock).toHaveBeenCalledWith('execute_user_deletion', { p_user_id: 'user-3' })
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({
      status: 'completed',
      executing_at: null,
      executed_at: '2026-06-10T00:00:00.000Z',
    })
    expect(updateEqMock).toHaveBeenCalledWith('id', 'req-3')
  })

  it('executeDeletion non fa nulla quando un altro worker ha gia` reclamato la richiesta', async () => {
    const updateMock = vi.fn()
    const fromMock = vi.fn(() => ({ select: vi.fn(), update: updateMock }))
    const rpcMock = vi.fn().mockResolvedValue({ data: false, error: null })
    createAdminClientMock.mockReturnValue({ from: fromMock, rpc: rpcMock })

    await executeDeletion('req-4')

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('executeDeletion registra il fallimento della purge senza dichiarare il completamento', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'req-5', user_id: 'user-5', status: 'executing' },
      error: null,
    })
    const selectEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn(() => ({ eq: updateEqMock }))
    const rpcMock = vi.fn((name: string) => {
      if (name === 'claim_account_deletion') return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: null, error: { message: 'purge ko' } })
    })
    const fromMock = vi.fn(() => ({ select: vi.fn(() => ({ eq: selectEqMock })), update: updateMock }))
    createAdminClientMock.mockReturnValue({ from: fromMock, rpc: rpcMock })

    await expect(executeDeletion('req-5')).rejects.toThrow('Errore execute_user_deletion: purge ko')

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({
      status: 'failed',
      executing_at: null,
      error_details: 'purge ko',
    })
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
