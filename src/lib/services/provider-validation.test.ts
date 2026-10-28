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

import { performCredentialValidationAttempt, removeApiKey, saveApiKey } from '@/lib/services/integrations'

/** Crea una credenziale privata nel confine utente e la conserva per il lettore service-role. */
function createCredentialClient(credentialId: string, keyVersion: string) {
  let row: Record<string, unknown> | null = null
  const selectQuery = {
    eq: vi.fn(() => selectQuery),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  }
  let updateFilterCount = 0
  const updateQuery = {
    eq: vi.fn(() => {
      updateFilterCount += 1
      return updateFilterCount === 2 ? Promise.resolve({ error: null }) : updateQuery
    }),
  }
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => selectQuery),
      upsert: vi.fn(async (values: Record<string, unknown>) => {
        row = { id: credentialId, ...values }
        return { error: null }
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        row = { ...(row ?? {}), ...values }
        updateFilterCount = 0
        return updateQuery
      }),
    })),
  }
  const saveRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'save_user_provider_credential_atomic') return { data: null, error: null }
    row = {
      id: credentialId,
      user_id: args.p_user_id,
      provider: args.p_provider,
      encrypted_key: args.p_encrypted_key,
      is_configured: true,
      is_valid: null,
      last_error: null,
      last_used_at: null,
    }
    return {
      data: [{ status: 'saved', credential_id: credentialId, retry_limit: 0, key_version: keyVersion }],
      error: null,
    }
  })
  return { client, getRow: () => row, saveRpc }
}

/** Configura il service-role reader e il sink append-only del ledger. */
function configureAdminClient(getCredentialRow: () => Record<string, unknown> | null, keyVersion: string, saveRpc: ReturnType<typeof vi.fn>) {
  const credentialQuery = {
    eq: vi.fn(() => credentialQuery),
    maybeSingle: vi.fn(async () => ({ data: getCredentialRow(), error: null })),
  }
  const policyQuery = {
    eq: vi.fn(() => policyQuery),
    maybeSingle: vi.fn(async () => ({ data: { retry_limit: 0, key_version: keyVersion }, error: null })),
  }
  // Consenso TOS corrente richiesto dal salvataggio chiave (K5): l'utente di test ha accettato.
  const tosQuery = {
    eq: vi.fn(() => tosQuery),
    limit: vi.fn(async () => ({ data: [{ document_kind: 'tos', document_version: '2026-10-25-1' }], error: null })),
  }
  createAdminClientMock.mockReturnValue({
    rpc: saveRpc,
    from: vi.fn((table: string) => {
      if (table === 'user_provider_credentials') return { select: vi.fn(() => credentialQuery) }
      if (table === 'user_provider_credential_retry_limits') return { select: vi.fn(() => policyQuery) }
      if (table === 'legal_acceptances') return { select: vi.fn(() => tosQuery) }
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
    const { client, getRow, saveRpc } = createCredentialClient(credentialId, keyVersion)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    configureAdminClient(getRow, keyVersion, saveRpc)
    await saveApiKey({
      userId: ownerId,
      provider: 'youtube',
      apiKey: 'test-youtube-provider-key',
      validateNow: false,
      supabase: client as unknown as AppSupabaseClient,
    })
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
    const { client, getRow, saveRpc } = createCredentialClient(credentialId, keyVersion)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    configureAdminClient(getRow, keyVersion, saveRpc)
    await saveApiKey({
      userId: ownerId,
      provider: 'gemini',
      apiKey: 'test-gemini-provider-key',
      validateNow: false,
      supabase: client as unknown as AppSupabaseClient,
    })
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
      // K3: la chiave Gemini viaggia nell'header, mai nella query string.
      const geminiUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
      expect(geminiUrl.searchParams.get('key')).toBeNull()
      expect(geminiUrl.search).toBe('')
      expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-gemini-provider-key')
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

  it('rifiuta il salvataggio di una chiave senza accettazione TOS corrente', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const ownerId = 'no-tos-owner'
    const credentialId = '00000000-0000-4000-8000-000000000060'
    const keyVersion = '00000000-0000-4000-8000-000000000061'
    const { client, getRow, saveRpc } = createCredentialClient(credentialId, keyVersion)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    configureAdminClient(getRow, keyVersion, saveRpc)
    // Nessuna accettazione TOS corrente: il client admin non trova righe valide.
    const noTosQuery = { eq: vi.fn(() => noTosQuery), limit: vi.fn(async () => ({ data: [], error: null })) }
    createAdminClientMock.mockReturnValue({
      rpc: saveRpc,
      from: vi.fn((table: string) => {
        if (table === 'legal_acceptances') return { select: vi.fn(() => noTosQuery) }
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })), insert: usageInsertMock }
      }),
    })

    try {
      await expect(saveApiKey({
        userId: ownerId,
        provider: 'gemini',
        apiKey: 'test-gemini-no-tos-key',
        validateNow: false,
        supabase: client as unknown as AppSupabaseClient,
      })).rejects.toMatchObject({ statusCode: 403, context: { code: 'TOS_ACCEPTANCE_REQUIRED' } })
      expect(saveRpc).not.toHaveBeenCalled()
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('non invia la verifica quando la chiave Gemini viene rimossa prima del lease', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const ownerId = 'gemini-removed-owner'
    const credentialId = '00000000-0000-4000-8000-000000000050'
    const keyVersion = '00000000-0000-4000-8000-000000000051'
    const apiKey = 'test-gemini-key-removed-before-lease'
    const { client, getRow, saveRpc } = createCredentialClient(credentialId, keyVersion)
    const fetchMock = vi.fn()
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      configureAdminClient(getRow, keyVersion, saveRpc)
      await saveApiKey({ userId: ownerId, provider: 'gemini', apiKey, validateNow: false, supabase: client as unknown as AppSupabaseClient })
      await removeApiKey({ userId: ownerId, provider: 'gemini', supabase: client as unknown as AppSupabaseClient })
      vi.stubGlobal('fetch', fetchMock)

      const result = await performCredentialValidationAttempt({
        userId: ownerId,
        credentialId,
        provider: 'gemini',
        keyVersion,
        retryLimit: 0,
      })

      expect(result).toMatchObject({ isValid: false, retryable: false, credentialChanged: true })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain(apiKey)
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })
})
