/* Commento didattico:
 * Scopo del file: verifica il confine HTTP v1 dell'annullamento cancellazione account, route che il middleware non autentica.
 * Moduli richiamati: route `v1/account/cancel-deletion` reale, mock Supabase admin e orologio finto.
 * Flusso: prova token valido/non valido, formato del body e assenza di RPC sui rifiuti, senza DB o rete.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import { POST } from '@/app/api/v1/account/cancel-deletion/route'
import { createCancelDeletionToken } from '@/lib/services/account-deletion'

const SECRET = 'test-account-deletion-secret'

function post(body?: unknown, url = 'http://localhost/api/v1/account/cancel-deletion') {
  return POST(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  )
}

function enableRpc(restored: unknown = true) {
  const rpcMock = vi.fn().mockResolvedValue({ data: restored, error: null })
  createAdminClientMock.mockReturnValue({ rpc: rpcMock })
  return rpcMock
}

describe('POST /api/v1/account/cancel-deletion', () => {
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

  it('annulla la cancellazione con token valido nel body e chiama la RPC una volta', async () => {
    const rpcMock = enableRpc(true)
    const token = createCancelDeletionToken('user-1', 'req-1', '2026-06-20T00:00:00.000Z')

    const response = await post({ token })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { restored: true } })
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('cancel_account_deletion', { p_user_id: 'user-1', p_request_id: 'req-1' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('annulla la cancellazione con token nella query per compatibilita` legacy', async () => {
    const rpcMock = enableRpc(true)
    const token = createCancelDeletionToken('user-legacy', 'req-legacy', '2026-06-20T00:00:00.000Z')

    const response = await post(undefined, `http://localhost/api/v1/account/cancel-deletion?token=${encodeURIComponent(token)}`)

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('cancel_account_deletion', { p_user_id: 'user-legacy', p_request_id: 'req-legacy' })
  })

  it('rifiuta con 401 un token non valido senza toccare il database', async () => {
    const rpcMock = enableRpc(true)

    const response = await post({ token: 'token-manomesso' })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rifiuta con 401 un token scaduto senza toccare il database', async () => {
    const rpcMock = enableRpc(true)
    const expired = createCancelDeletionToken('user-1', 'req-1', '2026-06-09T23:59:59.000Z')

    const response = await post({ token: expired })

    expect(response.status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it.each([
    ['body vuoto senza token', {}],
    ['campo extra nel body', { token: 'x', userId: 'user-vittima' }],
  ])('rifiuta con 400 %s senza toccare il database', async (_name, body) => {
    const rpcMock = enableRpc(true)

    const response = await post(body)

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rifiuta con 400 un body JSON malformato senza toccare il database', async () => {
    const rpcMock = enableRpc(true)

    const response = await POST(
      new Request('http://localhost/api/v1/account/cancel-deletion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"token":',
      })
    )

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('restituisce 409 quando la richiesta pending non e` piu` annullabile', async () => {
    const rpcMock = enableRpc(false)
    const token = createCancelDeletionToken('user-1', 'req-1', '2026-06-20T00:00:00.000Z')

    const response = await post({ token })

    expect(response.status).toBe(409)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})