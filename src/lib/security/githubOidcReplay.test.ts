/* Commento didattico:
 * Scopo del file: verifica il consumo monouso del nonce OIDC senza database reale.
 * Moduli richiamati: `../githubOidcReplay`, client admin Supabase mockato, `vitest`.
 * Flusso: simula insert ok/duplicato/errore e controlla cleanup, scadenza e mapping errori.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeGitHubOidcJti } from './githubOidcReplay'
import { AppError } from '@/lib/utils/errors'

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

describe('consumeGitHubOidcJti', () => {
  const ltMock = vi.fn()
  const deleteMock = vi.fn()
  const insertMock = vi.fn()
  const fromMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ltMock.mockResolvedValue({ error: null })
    deleteMock.mockReturnValue({ lt: ltMock })
    insertMock.mockResolvedValue({ error: null })
    fromMock.mockReturnValue({ delete: deleteMock, insert: insertMock })
    createAdminClientMock.mockReturnValue({ from: fromMock })
  })

  it('registra il nonce con scadenza oltre la tolleranza e pulisce gli scaduti', async () => {
    await consumeGitHubOidcJti('jti-1', 1_000_000)

    expect(deleteMock).toHaveBeenCalled()
    expect(ltMock).toHaveBeenCalledWith('expires_at', expect.any(String))
    expect(insertMock).toHaveBeenCalledWith({
      jti: 'jti-1',
      expires_at: new Date((1_000_000 + 60) * 1000).toISOString(),
    })
  })

  it('rifiuta il replay concorrente come non autorizzato', async () => {
    insertMock.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    const outcome = consumeGitHubOidcJti('jti-replay', 1_000_000)
    await expect(outcome).rejects.toBeInstanceOf(AppError)
    await expect(outcome).rejects.toMatchObject({ type: 'unauthorized', statusCode: 401 })
  })

  it('solleva errore interno quando la registrazione fallisce', async () => {
    insertMock.mockResolvedValue({ error: { code: '500', message: 'db down' } })
    await expect(consumeGitHubOidcJti('jti-2', 1_000_000)).rejects.toMatchObject({ type: 'unknown', statusCode: 500 })
  })
})
