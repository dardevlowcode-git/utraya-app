/* Commento didattico:
 * Scopo del file: verifica il salvataggio credenziale e il confine fra API sincrona e job pending.
 * Moduli richiamati: integrations, route utente, client Supabase mock e vitest.
 * Flusso: verifica owner-scoping, reset/preservazione e che il save non invochi direttamente il provider.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase/types'

const {
  createAdminClientMock,
  createClientMock,
  fromMock,
  insertMock,
  getCurrentSessionMock,
  enqueueCredentialValidationMock,
  getCredentialValidationStatusesForUserMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  insertMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  enqueueCredentialValidationMock: vi.fn(),
  getCredentialValidationStatusesForUserMock: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/auth/provider', () => ({ getCurrentSession: getCurrentSessionMock }))
vi.mock('@/lib/services/credential-validation-jobs', () => ({
  enqueueCredentialValidation: enqueueCredentialValidationMock,
  getCredentialValidationStatusesForUser: getCredentialValidationStatusesForUserMock,
}))

import { DELETE as deleteIntegrations, maxDuration as integrationsMaxDuration, POST as postIntegrations } from '@/app/api/integrations/route'
import { getCredentialStatusesForUser, removeApiKey, saveApiKey, writeCredentialCheckAudit } from '@/lib/services/integrations'

/** Crea un client utente minimo che conserva la riga credenziale durante il test. */
function createCredentialSupabase(credentialId: string) {
  let credentialRow: Record<string, unknown> | null = null
  const selectQuery = {
    eq: vi.fn(() => selectQuery),
    maybeSingle: vi.fn(async () => ({ data: credentialRow, error: null })),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: credentialRow ? [credentialRow] : [], error: null }).then(resolve, reject),
  }
  const updateFilters: Array<[string, string]> = []
  let updateFilterCount = 0
  const updateQuery = {
    eq: vi.fn((column: string, value: string) => {
      updateFilters.push([column, value])
      updateFilterCount += 1
      return updateFilterCount % 2 === 0 ? Promise.resolve({ error: null }) : updateQuery
    }),
  }
  const updateMock = vi.fn((values: Record<string, unknown>) => {
    credentialRow = { ...(credentialRow ?? {}), ...values }
    return updateQuery
  })
  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => selectQuery),
      upsert: vi.fn(async (values: Record<string, unknown>) => {
        credentialRow = { id: credentialId, ...values }
        return { error: null }
      }),
      update: updateMock,
    })),
  }
  return { supabase, getCredentialRow: () => credentialRow, updateFilters, updateMock }
}

/** Configura il confine privilegiato con retry metadata e insert audit/usage. */
function configureRetryLimitClient(retryLimit: number, keyVersion = 'version-default') {
  const retryLimitUpsert = vi.fn(async () => ({ error: null }))
  const retryQuery = {
    eq: vi.fn(() => retryQuery),
    in: vi.fn(async () => ({
      data: [{ credential_id: 'credential-pending', retry_limit: retryLimit, key_version: keyVersion }],
      error: null,
    })),
    maybeSingle: vi.fn(async () => ({ data: { retry_limit: retryLimit, key_version: keyVersion }, error: null })),
  }
  createAdminClientMock.mockReturnValue({
    from: vi.fn((table: string) => table === 'user_provider_credential_retry_limits'
      ? { select: vi.fn(() => retryQuery), upsert: retryLimitUpsert }
      : fromMock(table)),
  })
  return { retryLimitUpsert }
}

describe('credential save and validation enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReturnValue({ insert: insertMock })
    createAdminClientMock.mockReturnValue({ from: fromMock })
    insertMock.mockResolvedValue({ error: null })
    enqueueCredentialValidationMock.mockResolvedValue({ jobId: 'validation-job-1', status: 'pending' })
    getCredentialValidationStatusesForUserMock.mockResolvedValue(new Map())
    configureRetryLimitClient(0)
  })

  it('keeps the HTTP function timeout independent from persisted retries', () => {
    expect(integrationsMaxDuration).toBe(30)
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

  it('salva la chiave e risponde pending senza eseguire richieste provider', async () => {
    const userId = 'validation-owner'
    const { supabase } = createCredentialSupabase('credential-pending')
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const fetchMock = vi.fn()
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    createClientMock.mockResolvedValue(supabase)
    getCurrentSessionMock.mockResolvedValue({ userId })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const response = await postIntegrations(new Request('http://localhost/api/integrations', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'youtube', apiKey: 'test-youtube-key-pending', action: 'save' }),
      }))
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.data).toMatchObject({ isValid: null, validationStatus: 'pending' })
      expect(enqueueCredentialValidationMock).toHaveBeenCalledWith(expect.objectContaining({
        userId,
        credentialId: 'credential-pending',
        provider: 'youtube',
        retryLimit: 0,
        keyVersion: 'version-default',
      }))
      expect(JSON.stringify(enqueueCredentialValidationMock.mock.calls)).not.toContain('test-youtube-key-pending')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('accoda la discovery Firecrawl con owner, key-version e limite snapshot senza eseguire youtube/read', async () => {
    const userId = 'firecrawl-validation-owner'
    const keyVersion = 'firecrawl-key-version-1'
    const apiKey = 'test-firecrawl-key-for-queue'
    const { supabase } = createCredentialSupabase('credential-firecrawl-pending')
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const fetchMock = vi.fn()
    configureRetryLimitClient(0, keyVersion)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    createClientMock.mockResolvedValue(supabase)
    getCurrentSessionMock.mockResolvedValue({ userId })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const response = await postIntegrations(new Request('http://localhost/api/integrations', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'firecrawl', apiKey, action: 'save' }),
      }))
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.data).toMatchObject({ provider: 'firecrawl', isValid: null, validationStatus: 'pending' })
      expect(enqueueCredentialValidationMock).toHaveBeenCalledWith({
        credentialId: 'credential-firecrawl-pending',
        userId,
        provider: 'firecrawl',
        keyVersion,
        retryLimit: 0,
      })
      expect(JSON.stringify(result)).not.toContain(apiKey)
      expect(JSON.stringify(enqueueCredentialValidationMock.mock.calls)).not.toContain(apiKey)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('rimuove Firecrawl solo per owner/provider e azzera il segreto', async () => {
    const userId = 'firecrawl-removal-owner'
    const apiKey = 'test-firecrawl-key-to-remove'
    const { supabase, getCredentialRow, updateFilters, updateMock } = createCredentialSupabase('credential-firecrawl-remove')
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({
        userId,
        provider: 'firecrawl',
        apiKey,
        validateNow: false,
        supabase: supabase as unknown as AppSupabaseClient,
      })

      await removeApiKey({ userId, provider: 'firecrawl', supabase: supabase as unknown as AppSupabaseClient })

      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ encrypted_key: null, is_configured: false }))
      expect(updateFilters).toEqual([['user_id', userId], ['provider', 'firecrawl']])
      expect(getCredentialRow()).toMatchObject({ encrypted_key: null, is_configured: false })
      expect(JSON.stringify(getCredentialRow())).not.toContain(apiKey)
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('tratta una chiave Firecrawl sostituita come nuova versione e mantiene l’override sul risalvataggio identico', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase } = createCredentialSupabase('credential-firecrawl-replaced')
    const { retryLimitUpsert } = configureRetryLimitClient(5, 'previous-firecrawl-key-version')
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({ userId: 'firecrawl-replacement-owner', provider: 'firecrawl', apiKey: 'test-firecrawl-key-before', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      await saveApiKey({ userId: 'firecrawl-replacement-owner', provider: 'firecrawl', apiKey: 'test-firecrawl-key-after', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      expect(retryLimitUpsert).toHaveBeenCalledWith(expect.objectContaining({
        credential_id: 'credential-firecrawl-replaced',
        retry_limit: 0,
        key_version: expect.any(String),
      }))

      retryLimitUpsert.mockClear()
      await saveApiKey({ userId: 'firecrawl-replacement-owner', provider: 'firecrawl', apiKey: 'test-firecrawl-key-after', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      expect(retryLimitUpsert).not.toHaveBeenCalled()
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('mappa il job pending solo sulla versione corrente e non cambia owner/provider', async () => {
    const { supabase } = createCredentialSupabase('credential-pending')
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({
        userId: 'validation-owner',
        provider: 'youtube',
        apiKey: 'test-youtube-key-status',
        validateNow: false,
        supabase: supabase as unknown as AppSupabaseClient,
      })
      getCredentialValidationStatusesForUserMock.mockResolvedValueOnce(
        new Map([['credential-pending', 'pending']])
      )

      const statuses = await getCredentialStatusesForUser('validation-owner', supabase as unknown as AppSupabaseClient)

      expect(statuses.find((status) => status.provider === 'youtube')).toMatchObject({
        isConfigured: true,
        validationStatus: 'pending',
      })
      expect(getCredentialValidationStatusesForUserMock).toHaveBeenCalledWith(
        'validation-owner',
        supabase,
        new Map([['credential-pending', 'version-default']])
      )
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('mostra lo stato pending Firecrawl soltanto per la versione corrente della chiave', async () => {
    const { supabase } = createCredentialSupabase('credential-pending')
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({
        userId: 'firecrawl-status-owner',
        provider: 'firecrawl',
        apiKey: 'test-firecrawl-key-status',
        validateNow: false,
        supabase: supabase as unknown as AppSupabaseClient,
      })
      getCredentialValidationStatusesForUserMock.mockResolvedValueOnce(
        new Map([['credential-pending', 'pending']])
      )

      const statuses = await getCredentialStatusesForUser('firecrawl-status-owner', supabase as unknown as AppSupabaseClient)

      expect(statuses.find((status) => status.provider === 'firecrawl')).toMatchObject({
        isConfigured: true,
        isValid: null,
        validationStatus: 'pending',
        maskedKey: expect.stringMatching(/atus$/),
      })
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('mantiene l’override admin quando si risalva lo stesso segreto', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase } = createCredentialSupabase('credential-same-secret')
    const { retryLimitUpsert } = configureRetryLimitClient(7)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({ userId: 'same-secret-owner', provider: 'youtube', apiKey: 'test-youtube-key-same-secret', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      await saveApiKey({ userId: 'same-secret-owner', provider: 'youtube', apiKey: 'test-youtube-key-same-secret', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      expect(retryLimitUpsert).not.toHaveBeenCalled()
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('azzera il limite e cambia versione solo quando si sostituisce la chiave', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase } = createCredentialSupabase('credential-replaced-secret')
    const { retryLimitUpsert } = configureRetryLimitClient(7)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({ userId: 'replacement-owner', provider: 'youtube', apiKey: 'test-youtube-key-before-replacement', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      await saveApiKey({ userId: 'replacement-owner', provider: 'youtube', apiKey: 'test-youtube-key-after-replacement', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      expect(retryLimitUpsert).toHaveBeenCalledWith(expect.objectContaining({
        credential_id: 'credential-replaced-secret',
        retry_limit: 0,
        key_version: expect.any(String),
      }))
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })
})
