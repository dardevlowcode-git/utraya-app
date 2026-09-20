/* Commento didattico:
 * Scopo del file: testa i service legal acceptance per stato richiesto e persistenza accettazioni probatorie.
 * Moduli richiamati: service legal-acceptance, costanti version/hash, mock createAdminClient.
 * Flusso: simula query/insert su Supabase e verifica mapping missing/rows e gestione duplicate key.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRIVACY_VISIBLE_HASH,
  PRIVACY_VISIBLE_VERSION,
  TOS_REQUIRED_HASH,
  TOS_REQUIRED_VERSION,
  TOS_VEX_REQUIRED_HASH,
  TOS_VEX_REQUIRED_VERSION,
} from '@/lib/legal/required'
import { getLegalAcceptanceStatus, recordLegalAcceptance } from '@/lib/services/legal-acceptance'

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

describe('legal-acceptance service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getLegalAcceptanceStatus segnala utente compliant quando entrambe le accettazioni sono presenti', async () => {
    const inMock = vi.fn().mockResolvedValue({
      data: [
        { document_kind: 'tos', document_version: TOS_REQUIRED_VERSION },
        { document_kind: 'tos_vexatorious', document_version: TOS_VEX_REQUIRED_VERSION },
      ],
      error: null,
    })
    const eqMock = vi.fn(() => ({ in: inMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    const fromMock = vi.fn(() => ({ select: selectMock }))
    createAdminClientMock.mockReturnValue({ from: fromMock })

    const result = await getLegalAcceptanceStatus('user-1', 'en')

    expect(result).toEqual({
      needsAcceptance: false,
      missing: [],
      tosVersion: TOS_REQUIRED_VERSION,
      tosHash: TOS_REQUIRED_HASH,
      tosVexVersion: TOS_VEX_REQUIRED_VERSION,
      tosVexHash: TOS_VEX_REQUIRED_HASH,
      privacyVersion: PRIVACY_VISIBLE_VERSION,
      privacyHash: PRIVACY_VISIBLE_HASH,
      currentLocale: 'en',
    })
  })

  it('getLegalAcceptanceStatus segnala entrambe le accettazioni come mancanti quando tabella vuota', async () => {
    const inMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const eqMock = vi.fn(() => ({ in: inMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => ({ select: selectMock })) })

    const result = await getLegalAcceptanceStatus('user-2')

    expect(result.needsAcceptance).toBe(true)
    expect(result.missing).toEqual(['tos', 'tos_vexatorious'])
  })

  it('recordLegalAcceptance inserisce righe con versione/hash canoniche per ogni kind', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    const fromMock = vi.fn(() => ({ insert: insertMock }))
    createAdminClientMock.mockReturnValue({ from: fromMock })

    await recordLegalAcceptance({
      userId: 'user-3',
      userEmail: 'user3@example.com',
      kinds: ['tos', 'tos_vexatorious'],
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      locale: 'it',
    })

    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: 'user-3',
        document_kind: 'tos',
        document_version: TOS_REQUIRED_VERSION,
        document_hash: TOS_REQUIRED_HASH,
      }),
      expect.objectContaining({
        user_id: 'user-3',
        document_kind: 'tos_vexatorious',
        document_version: TOS_VEX_REQUIRED_VERSION,
        document_hash: TOS_VEX_REQUIRED_HASH,
      }),
    ])
  })

  it('recordLegalAcceptance ignora duplicate key idempotente ma rilancia altri errori', async () => {
    const duplicateInsertMock = vi.fn().mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint' } })
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => ({ insert: duplicateInsertMock })) })

    await expect(
      recordLegalAcceptance({
        userId: 'user-4',
        userEmail: 'user4@example.com',
        kinds: ['tos'],
        ipAddress: null,
        userAgent: null,
        locale: 'it',
      })
    ).resolves.toBeUndefined()

    const failingInsertMock = vi.fn().mockResolvedValue({ error: { message: 'permission denied' } })
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => ({ insert: failingInsertMock })) })

    await expect(
      recordLegalAcceptance({
        userId: 'user-4',
        userEmail: 'user4@example.com',
        kinds: ['tos'],
        ipAddress: null,
        userAgent: null,
        locale: 'it',
      })
    ).rejects.toThrow('Errore insert legal_acceptances: permission denied')
  })
})
