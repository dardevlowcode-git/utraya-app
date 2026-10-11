/* Commento didattico:
 * Scopo del file: verifica l'adapter provider di un singolo attempt same-key e il relativo ledger.
 * Moduli richiamati: saveApiKey, attempt di validazione, client Supabase mock e vitest.
 * Flusso: usa chiavi sintetiche cifrate dal service e mocka solo fetch e persistenza esterna.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase/types'

const { createAdminClientMock, fromMock, usageInsertMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  fromMock: vi.fn(),
  usageInsertMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import { performCredentialValidationAttempt, saveApiKey } from '@/lib/services/integrations'

/** Crea una credenziale privata nel confine utente e la conserva per il lettore service-role. */
function createCredentialClient(credentialId: string) {
  let row: Record<string, unknown> | null = null
  const selectQuery = {
    eq: vi.fn(() => selectQuery),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  }
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => selectQuery),
      upsert: vi.fn(async (values: Record<string, unknown>) => {
        row = { id: credentialId, ...values }
        return { error: null }
      }),
    })),
  }
  return { client, getRow: () => row }
}

/** Configura il service-role reader e il sink append-only del ledger. */
function configureAdminClient(getCredentialRow: () => Record<string, unknown> | null, keyVersion: string) {
  const credentialQuery = {
    eq: vi.fn(() => credentialQuery),
    maybeSingle: vi.fn(async () => ({ data: getCredentialRow(), error: null })),
  }
  const policyQuery = {
    eq: vi.fn(() => policyQuery),
    maybeSingle: vi.fn(async () => ({ data: { retry_limit: 0, key_version: keyVersion }, error: null })),
  }
  createAdminClientMock.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'user_provider_credentials') return { select: vi.fn(() => credentialQuery) }
      if (table === 'user_provider_credential_retry_limits') return { select: vi.fn(() => policyQuery) }
      return { insert: usageInsertMock }
    }),
  })
}

describe('performCredentialValidationAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usageInsertMock.mockResolvedValue({ error: null })
  })

  it('invia una sola richiesta YouTube e registra errore 5xx per la continuazione persistente', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const ownerId = 'youtube-attempt-owner'
    const credentialId = '00000000-0000-4000-8000-000000000010'
    const keyVersion = '00000000-0000-4000-8000-000000000011'
    const { client, getRow } = createCredentialClient(credentialId)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    await saveApiKey({
      userId: ownerId,
      provider: 'youtube',
      apiKey: 'test-youtube-provider-key',
      validateNow: false,
      supabase: client as unknown as AppSupabaseClient,
    })
    configureAdminClient(getRow, keyVersion)
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await performCredentialValidationAttempt({
        userId: ownerId,
        credentialId,
        provider: 'youtube',
        keyVersion,
        retryLimit: 10,
      })

      expect(result).toMatchObject({ isValid: false, retryable: true, errorType: 'temporary' })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
      expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('key')).toBe('test-youtube-provider-key')
      expect(usageInsertMock).toHaveBeenCalledWith(expect.objectContaining({
        user_id: ownerId,
        provider: 'youtube',
        operation: 'search.list',
        outcome: 'http_error',
        http_status: 503,
      }))
      expect(JSON.stringify(usageInsertMock.mock.calls)).not.toContain('test-youtube-provider-key')
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('non ritenta quota Gemini e non attribuisce costi o token non ricevuti', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const ownerId = 'gemini-attempt-owner'
    const credentialId = '00000000-0000-4000-8000-000000000020'
    const keyVersion = '00000000-0000-4000-8000-000000000021'
    const { client, getRow } = createCredentialClient(credentialId)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    await saveApiKey({
      userId: ownerId,
      provider: 'gemini',
      apiKey: 'test-gemini-provider-key',
      validateNow: false,
      supabase: client as unknown as AppSupabaseClient,
    })
    configureAdminClient(getRow, keyVersion)
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await performCredentialValidationAttempt({
        userId: ownerId,
        credentialId,
        provider: 'gemini',
        keyVersion,
        retryLimit: 10,
      })

      expect(result).toMatchObject({ isValid: false, retryable: false, errorType: 'structural' })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(usageInsertMock).toHaveBeenCalledWith(expect.objectContaining({
        user_id: ownerId,
        provider: 'gemini',
        operation: 'models.list',
        outcome: 'http_error',
        http_status: 429,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        estimated_cost_usd: null,
      }))
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })
})
