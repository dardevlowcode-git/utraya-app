/* Commento didattico:
 * Scopo del file: verifica il writer privilegiato dello storico validazioni credenziali.
 * Moduli richiamati: `integrations`, client Supabase admin e `vitest`.
 * Flusso: controlla che l'insert usi la tabella server-only e che un rifiuto RLS resti fail-open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClientMock, fromMock, insertMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  fromMock: vi.fn(),
  insertMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

import { writeCredentialCheckAudit } from '@/lib/services/integrations'

describe('writeCredentialCheckAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReturnValue({ insert: insertMock })
    createAdminClientMock.mockReturnValue({ from: fromMock })
    insertMock.mockResolvedValue({ error: null })
  })

  it('scrive lo storico con il client privilegiato e il payload minimo', async () => {
    const audit = {
      credential_id: 'credential-1',
      is_valid: true,
      error_message: null,
      error_type: null,
    }

    await writeCredentialCheckAudit(audit)

    expect(createAdminClientMock).toHaveBeenCalledOnce()
    expect(fromMock).toHaveBeenCalledWith('credential_checks')
    expect(insertMock).toHaveBeenCalledWith(audit)
  })

  it('non fa fallire la validazione quando il database rifiuta l’insert audit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    insertMock.mockResolvedValue({ error: { code: '42501', message: 'row violates row-level security policy' } })

    await expect(writeCredentialCheckAudit({
      credential_id: 'credential-1',
      is_valid: false,
      error_message: 'provider validation failed',
      error_type: 'structural',
    })).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('credential_checks audit insert failed; validation result retained')
    errorSpy.mockRestore()
  })
})
