import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase/types'

const {
  createAdminClientMock,
  createClientMock,
  fromMock,
  rpcMock,
  insertMock,
  getCurrentSessionMock,
  enqueueCredentialValidationMock,
  getCredentialValidationStatusesForUserMock,
  runCredentialValidationJobInlineMock,
  afterMock,
} = vi.hoisted(() => ({
  runCredentialValidationJobInlineMock: vi.fn(),
  afterMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
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
  runCredentialValidationJobInline: runCredentialValidationJobInlineMock,
}))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: afterMock }))

import { POST as postIntegrations } from '@/app/api/integrations/route'
import { getCredentialStatusesForUser, removeApiKey, runCredentialValidationJob, saveApiKey, writeCredentialCheckAudit } from '@/lib/services/integrations'

let activeCredentialState: {
  credentialId: string
  credentialRow: Record<string, unknown> | null
  retryLimit: number
  keyVersion: string
  setRetryPolicy: (retryLimit: number, keyVersion: string) => void
  setCredentialRow: (values: Record<string, unknown>) => void
  replaceCredentialRow: (row: Record<string, unknown> | null) => void
} | null = null
let initialKeyVersion = 'version-default'
let atomicVersionSequence = 0

/** Crea un client utente minimo che conserva la riga credenziale durante il test. */
function createCredentialSupabase(credentialId: string) {
  let credentialRow: Record<string, unknown> | null = null
  const state: NonNullable<typeof activeCredentialState> = {
    credentialId,
    credentialRow,
    retryLimit: 0,
    keyVersion: initialKeyVersion,
    setRetryPolicy(retryLimit: number, keyVersion: string) {
      state.retryLimit = retryLimit
      state.keyVersion = keyVersion
    },
    setCredentialRow(values: Record<string, unknown>) {
      credentialRow = { ...(credentialRow ?? {}), ...values }
      state.credentialRow = credentialRow
    },
    replaceCredentialRow(row: Record<string, unknown> | null) {
      credentialRow = row
      state.credentialRow = row
    },
  }
  activeCredentialState = state
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
    state.credentialRow = credentialRow
    return updateQuery
  })
  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => selectQuery),
      upsert: vi.fn(async (values: Record<string, unknown>) => {
        credentialRow = { id: credentialId, ...values }
        state.credentialRow = credentialRow
        return { error: null }
      }),
      update: updateMock,
    })),
  }
  configureCredentialSaveRpc(state)
  return {
    supabase,
    getCredentialRow: () => credentialRow,
    setCredentialRow: state.setCredentialRow,
    state,
    updateFilters,
    updateMock,
  }
}

/** Configura il confine privilegiato con retry metadata e insert audit/usage. */
function configureRetryLimitClient(retryLimit: number, keyVersion = 'version-default') {
  initialKeyVersion = keyVersion
  if (activeCredentialState?.credentialRow === null) activeCredentialState.keyVersion = keyVersion
  const retryLimitUpsert = vi.fn(async (values: Record<string, unknown>) => {
    if (activeCredentialState) {
      activeCredentialState.setRetryPolicy(Number(values.retry_limit), String(values.key_version ?? activeCredentialState.keyVersion))
    }
    return { error: null }
  })
  const retryQuery = {
    eq: vi.fn(() => retryQuery),
    in: vi.fn(async () => ({
      data: [activeCredentialState
        ? {
            credential_id: activeCredentialState.credentialId,
            retry_limit: activeCredentialState.retryLimit,
            key_version: activeCredentialState.keyVersion,
          }
        : { credential_id: 'credential-pending', retry_limit: retryLimit, key_version: keyVersion }],
      error: null,
    })),
    maybeSingle: vi.fn(async () => ({
      data: activeCredentialState
        ? { retry_limit: activeCredentialState.retryLimit, key_version: activeCredentialState.keyVersion }
        : { retry_limit: retryLimit, key_version: keyVersion },
      error: null,
    })),
  }
  // Consenso TOS corrente richiesto dal salvataggio chiave (K5): l'utente di test risulta aver accettato.
  const tosQuery = {
    eq: vi.fn(() => tosQuery),
    limit: vi.fn(async () => ({ data: [{ document_kind: 'tos', document_version: '2026-10-25-1' }], error: null })),
  }
  createAdminClientMock.mockReturnValue({
    rpc: rpcMock,
    from: vi.fn((table: string) => {
      if (table === 'user_provider_credential_retry_limits') return { select: vi.fn(() => retryQuery), upsert: retryLimitUpsert }
      if (table === 'legal_acceptances') return { select: vi.fn(() => tosQuery) }
      return fromMock(table)
    }),
  })
  return { retryLimitUpsert, rpcMock }
}

/** Simula il contratto transazionale/CAS del solo confine PostgreSQL con ciphertext sintetici. */
function configureCredentialSaveRpc(state: NonNullable<typeof activeCredentialState>): void {
  rpcMock.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'save_user_provider_credential_atomic') {
      return { data: null, error: null }
    }

    const conflict = { status: 'conflict', credential_id: null, retry_limit: null, key_version: null }
    const saved = () => ({
      status: 'saved',
      credential_id: state.credentialId,
      retry_limit: state.retryLimit,
      key_version: state.keyVersion,
    })
    const credentialId = args.p_credential_id
    if (credentialId === null) {
      if (state.credentialRow) return { data: [conflict], error: null }
      state.replaceCredentialRow({
        id: state.credentialId,
        user_id: args.p_user_id,
        provider: args.p_provider,
        encrypted_key: args.p_encrypted_key,
        is_configured: true,
        is_valid: null,
        last_error: null,
        last_used_at: null,
      })
      state.retryLimit = 0
      state.keyVersion = initialKeyVersion
      return { data: [saved()], error: null }
    }

    if (credentialId !== state.credentialId
        || state.credentialRow?.encrypted_key !== args.p_expected_encrypted_key
        || state.keyVersion !== args.p_expected_key_version) {
      return { data: [conflict], error: null }
    }
    if (args.p_reset_retry_policy === true) {
      state.retryLimit = 0
      atomicVersionSequence += 1
      state.keyVersion = `atomic-version-${atomicVersionSequence}`
    }
    state.setCredentialRow({
      ...state.credentialRow,
      encrypted_key: args.p_encrypted_key,
      is_configured: true,
      is_valid: null,
      last_error: null,
      last_used_at: null,
    })
    return { data: [saved()], error: null }
  })
}

describe('credential save and validation enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcMock.mockReset()
    activeCredentialState = null
    initialKeyVersion = 'version-default'
    atomicVersionSequence = 0
    fromMock.mockReturnValue({ insert: insertMock })
    createAdminClientMock.mockReturnValue({ from: fromMock })
    insertMock.mockResolvedValue({ error: null })
    enqueueCredentialValidationMock.mockResolvedValue({ jobId: 'validation-job-1', status: 'pending' })
    getCredentialValidationStatusesForUserMock.mockResolvedValue(new Map())
    configureRetryLimitClient(0)
  })

  it('lavora il job accodato con il solo attempt provider same-key e restituisce la Promise', async () => {
    const workerPromise = Promise.resolve({ attempts: 1, status: 'completed' })
    runCredentialValidationJobInlineMock.mockReturnValue(workerPromise)

    expect(runCredentialValidationJob('job-immediate')).toBe(workerPromise)
    expect(runCredentialValidationJobInlineMock).toHaveBeenCalledWith({
      jobId: 'job-immediate',
      attemptProvider: expect.any(Function),
    })
  })

  it('salva la chiave senza contattare il provider né accodare il segreto in chiaro', async () => {
    const userId = 'service-save-owner'
    const apiKey = 'test-secret-gemini-service-key'
    const keyVersion = 'service-save-key-version'
    const { supabase } = createCredentialSupabase('credential-service-save')
    const fetchMock = vi.fn()
    configureRetryLimitClient(0, keyVersion)
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'test-only-encryption-key')
    vi.stubGlobal('fetch', fetchMock)

    try {
      const saved = await saveApiKey({
        userId,
        provider: 'gemini',
        apiKey,
        supabase: supabase as unknown as AppSupabaseClient,
      })

      expect(saved).toMatchObject({
        provider: 'gemini',
        validationStatus: 'pending',
        jobId: 'validation-job-1',
      })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(enqueueCredentialValidationMock).toHaveBeenCalledWith({
        credentialId: 'credential-service-save',
        userId,
        provider: 'gemini',
        keyVersion,
        retryLimit: 0,
      })
      expect(JSON.stringify(enqueueCredentialValidationMock.mock.calls)).not.toContain(apiKey)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
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

  it('accoda la validazione Gemini con owner, key-version e limite snapshot', async () => {
    const userId = 'gemini-validation-owner'
    const keyVersion = 'gemini-key-version-1'
    const apiKey = 'test-gemini-key-for-queue'
    const { supabase } = createCredentialSupabase('credential-gemini-pending')
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
        body: JSON.stringify({ provider: 'gemini', apiKey, action: 'save' }),
      }))
      const result = await response.json()

      expect(response.status).toBe(202)
      expect(result.data).toMatchObject({ provider: 'gemini', jobId: 'validation-job-1', isValid: null, validationStatus: 'pending' })
      expect(enqueueCredentialValidationMock).toHaveBeenCalledWith({
        credentialId: 'credential-gemini-pending',
        userId,
        provider: 'gemini',
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

  it('rimuove Gemini solo per owner/provider e azzera il segreto', async () => {
    const userId = 'gemini-removal-owner'
    const apiKey = 'test-gemini-key-to-remove'
    const { supabase, getCredentialRow, updateFilters, updateMock } = createCredentialSupabase('credential-gemini-remove')
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({
        userId,
        provider: 'gemini',
        apiKey,
        validateNow: false,
        supabase: supabase as unknown as AppSupabaseClient,
      })

      await removeApiKey({ userId, provider: 'gemini', supabase: supabase as unknown as AppSupabaseClient })

      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ encrypted_key: null, is_configured: false }))
      expect(updateFilters).toEqual([['user_id', userId], ['provider', 'gemini']])
      expect(getCredentialRow()).toMatchObject({ encrypted_key: null, is_configured: false })
      expect(JSON.stringify(getCredentialRow())).not.toContain(apiKey)
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('preserva chiave, override e job se la sostituzione atomica del segreto fallisce', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase, getCredentialRow, state } = createCredentialSupabase('credential-atomic-failure')
    const { rpcMock: replacementRpc } = configureRetryLimitClient(6, 'existing-key-version')
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({
        userId: 'atomic-owner',
        provider: 'youtube',
        apiKey: 'test-youtube-key-original',
        validateNow: false,
        supabase: supabase as unknown as AppSupabaseClient,
      })
      state.setRetryPolicy(6, state.keyVersion)
      const originalRow = { ...getCredentialRow() }
      const originalVersion = state.keyVersion
      replacementRpc.mockResolvedValueOnce({ data: null, error: { message: 'transaction rejected' } })

      await expect(saveApiKey({
        userId: 'atomic-owner',
        provider: 'youtube',
        apiKey: 'test-youtube-key-replacement',
        validateNow: false,
        supabase: supabase as unknown as AppSupabaseClient,
      })).rejects.toMatchObject({ message: 'Impossibile salvare la chiave API' })

      expect(getCredentialRow()).toEqual(originalRow)
      expect(state.retryLimit).toBe(6)
      expect(state.keyVersion).toBe(originalVersion)
      expect(replacementRpc).toHaveBeenCalledWith('save_user_provider_credential_atomic', expect.objectContaining({
        p_credential_id: 'credential-atomic-failure',
        p_user_id: 'atomic-owner',
        p_provider: 'youtube',
        p_encrypted_key: expect.any(String),
        p_expected_encrypted_key: originalRow.encrypted_key,
        p_expected_key_version: originalVersion,
        p_reset_retry_policy: true,
      }))
      expect(enqueueCredentialValidationMock).not.toHaveBeenCalled()
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('rilegge e ricalcola replacement dopo un conflitto CAS concorrente', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase, getCredentialRow, setCredentialRow, state } = createCredentialSupabase('credential-cas-race')
    const { rpcMock: saveRpc } = configureRetryLimitClient(0, 'cas-version-initial')
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({ userId: 'cas-owner', provider: 'youtube', apiKey: 'test-youtube-key-initial', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      const staleRow = { ...getCredentialRow()! }
      const staleVersion = state.keyVersion

      await saveApiKey({ userId: 'cas-owner', provider: 'youtube', apiKey: 'test-youtube-key-concurrent', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      const concurrentRow = { ...getCredentialRow()! }
      const concurrentVersion = state.keyVersion

      state.setRetryPolicy(5, staleVersion)
      setCredentialRow(staleRow)
      const firstCallIndex = saveRpc.mock.calls.length
      saveRpc.mockImplementationOnce(async () => {
        setCredentialRow(concurrentRow)
        state.setRetryPolicy(0, concurrentVersion)
        return {
          data: [{ status: 'conflict', credential_id: null, retry_limit: null, key_version: null }],
          error: null,
        }
      })

      const saved = await saveApiKey({ userId: 'cas-owner', provider: 'youtube', apiKey: 'test-youtube-key-requested', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      const casCalls = saveRpc.mock.calls.slice(firstCallIndex)

      expect(casCalls).toHaveLength(2)
      expect(casCalls[0][1]).toMatchObject({
        p_expected_encrypted_key: staleRow.encrypted_key,
        p_expected_key_version: staleVersion,
        p_reset_retry_policy: true,
      })
      expect(casCalls[1][1]).toMatchObject({
        p_expected_encrypted_key: concurrentRow.encrypted_key,
        p_expected_key_version: concurrentVersion,
        p_reset_retry_policy: true,
      })
      expect(getCredentialRow()?.encrypted_key).toBe(casCalls[1][1].p_encrypted_key)
      expect(state.retryLimit).toBe(0)
      expect(state.keyVersion).not.toBe(concurrentVersion)
      expect(saved.maskedKey.endsWith('sted')).toBe(true)
      expect(JSON.stringify(casCalls)).not.toContain('test-youtube-key-initial')
      expect(JSON.stringify(casCalls)).not.toContain('test-youtube-key-concurrent')
      expect(JSON.stringify(casCalls)).not.toContain('test-youtube-key-requested')
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
        isValid: null,
        validationStatus: 'pending',
        maskedKey: expect.stringMatching(/atus$/),
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

  it('mantiene l’override admin quando si risalva lo stesso segreto', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase, state } = createCredentialSupabase('credential-same-secret')
    const { retryLimitUpsert, rpcMock: saveRpc } = configureRetryLimitClient(7)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({ userId: 'same-secret-owner', provider: 'youtube', apiKey: 'test-youtube-key-same-secret', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      state.setRetryPolicy(7, state.keyVersion)
      const versionBefore = state.keyVersion
      await saveApiKey({ userId: 'same-secret-owner', provider: 'youtube', apiKey: 'test-youtube-key-same-secret', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      expect(retryLimitUpsert).not.toHaveBeenCalled()
      expect(state.retryLimit).toBe(7)
      expect(state.keyVersion).toBe(versionBefore)
      expect(saveRpc).toHaveBeenLastCalledWith('save_user_provider_credential_atomic', expect.objectContaining({
        p_reset_retry_policy: false,
        p_expected_key_version: versionBefore,
      }))
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('azzera il limite e cambia versione solo quando si sostituisce la chiave', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase, state } = createCredentialSupabase('credential-replaced-secret')
    const { retryLimitUpsert, rpcMock: replacementRpc } = configureRetryLimitClient(7)
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'

    try {
      await saveApiKey({ userId: 'replacement-owner', provider: 'youtube', apiKey: 'test-youtube-key-before-replacement', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      state.setRetryPolicy(7, state.keyVersion)
      const oldVersion = state.keyVersion
      await saveApiKey({ userId: 'replacement-owner', provider: 'youtube', apiKey: 'test-youtube-key-after-replacement', validateNow: false, supabase: supabase as unknown as AppSupabaseClient })
      expect(retryLimitUpsert).not.toHaveBeenCalled()
      expect(state.retryLimit).toBe(0)
      expect(state.keyVersion).not.toBe(oldVersion)
      expect(replacementRpc).toHaveBeenLastCalledWith('save_user_provider_credential_atomic', expect.objectContaining({
        p_credential_id: 'credential-replaced-secret',
        p_user_id: 'replacement-owner',
        p_provider: 'youtube',
        p_reset_retry_policy: true,
        p_expected_key_version: oldVersion,
      }))
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })
})
