/* Commento didattico:
 * Scopo del file: verifica il writer privilegiato dello storico validazioni credenziali.
 * Moduli richiamati: `integrations`, client Supabase admin e `vitest`.
 * Flusso: controlla che l'insert usi la tabella server-only e che un rifiuto RLS resti fail-open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase/types'

const { createAdminClientMock, createClientMock, fromMock, insertMock, getCurrentSessionMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  insertMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/auth/provider', () => ({ getCurrentSession: getCurrentSessionMock }))

import { maxDuration as integrationsMaxDuration, POST as postIntegrations } from '@/app/api/integrations/route'
import { saveApiKey, writeCredentialCheckAudit } from '@/lib/services/integrations'

/** Crea un client minimo per salvare, rileggere e aggiornare una credenziale di test. */
function createCredentialSupabase(credentialId: string) {
  let credentialRow: Record<string, unknown> | null = null
  const selectQuery = {
    eq: vi.fn(() => selectQuery),
    maybeSingle: vi.fn(async () => ({ data: credentialRow, error: null })),
  }
  let updateFilterCount = 0
  const updateQuery = {
    eq: vi.fn(() => {
      updateFilterCount += 1
      return updateFilterCount % 2 === 0 ? Promise.resolve({ error: null }) : updateQuery
    }),
  }
  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => selectQuery),
      upsert: vi.fn(async (values: Record<string, unknown>) => {
        credentialRow = { id: credentialId, ...values }
        return { error: null }
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        credentialRow = { ...(credentialRow ?? {}), ...values }
        return updateQuery
      }),
    })),
  }

  return { supabase, getCredentialRow: () => credentialRow }
}

describe('writeCredentialCheckAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReturnValue({ insert: insertMock })
    createAdminClientMock.mockReturnValue({ from: fromMock })
    insertMock.mockResolvedValue({ error: null })
  })

  it('riserva 30 secondi alla route integrazioni per il retry provider limitato', () => {
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

  it('attribuisce al proprietario della chiave la chiamata effettiva di validazione YouTube', async () => {
    const ownerId = 'credential-owner'
    const apiKey = 'test-youtube-key-for-owner'
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    let credentialRow: Record<string, unknown> | null = null
    const selectQuery = {
      eq: vi.fn(() => selectQuery),
      maybeSingle: vi.fn(async () => ({ data: credentialRow, error: null })),
    }
    let updateFilterCount = 0
    const updateQuery = {
      eq: vi.fn(() => {
        updateFilterCount += 1
        return updateFilterCount === 2 ? Promise.resolve({ error: null }) : updateQuery
      }),
    }
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => selectQuery),
        upsert: vi.fn(async (values: Record<string, unknown>) => {
          credentialRow = { id: 'credential-1', ...values }
          return { error: null }
        }),
        update: vi.fn((values: Record<string, unknown>) => {
          credentialRow = { ...(credentialRow ?? {}), ...values }
          return updateQuery
        }),
      })),
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    vi.stubGlobal('fetch', fetchMock)

    try {
      await saveApiKey({
        userId: ownerId,
        provider: 'youtube',
        apiKey,
        supabase: supabase as unknown as AppSupabaseClient,
      })

      const requestEvent = insertMock.mock.calls
        .map(([payload]) => payload)
        .find((payload) => typeof payload === 'object' && payload !== null && 'provider' in payload)

      expect(requestEvent).toMatchObject({
        user_id: ownerId,
        provider: 'youtube',
        operation: 'search.list',
        outcome: 'success',
      })
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
      expect(selectQuery.eq).toHaveBeenCalledWith('user_id', ownerId)
      expect(fromMock.mock.calls.map(([table]) => table)).toEqual(['api_usage_events', 'credential_checks'])
      expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('key')).toBe(apiKey)
      expect(JSON.stringify(insertMock.mock.calls)).not.toContain(apiKey)
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('non attribuisce token o costo inventati alla validazione Gemini models.list', async () => {
    const ownerId = 'gemini-credential-owner'
    const apiKey = 'test-gemini-key-for-owner'
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    let credentialRow: Record<string, unknown> | null = null
    const selectQuery = {
      eq: vi.fn(() => selectQuery),
      maybeSingle: vi.fn(async () => ({ data: credentialRow, error: null })),
    }
    let updateFilterCount = 0
    const updateQuery = {
      eq: vi.fn(() => {
        updateFilterCount += 1
        return updateFilterCount === 2 ? Promise.resolve({ error: null }) : updateQuery
      }),
    }
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => selectQuery),
        upsert: vi.fn(async (values: Record<string, unknown>) => {
          credentialRow = { id: 'credential-gemini', ...values }
          return { error: null }
        }),
        update: vi.fn((values: Record<string, unknown>) => {
          credentialRow = { ...(credentialRow ?? {}), ...values }
          return updateQuery
        }),
      })),
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    vi.stubGlobal('fetch', fetchMock)

    try {
      await saveApiKey({
        userId: ownerId,
        provider: 'gemini',
        apiKey,
        supabase: supabase as unknown as AppSupabaseClient,
      })

      const requestEvent = insertMock.mock.calls
        .map(([payload]) => payload as Record<string, unknown>)
        .find((payload) => payload.provider === 'gemini')

      expect(requestEvent).toMatchObject({
        user_id: ownerId,
        operation: 'models.list',
        outcome: 'success',
        http_status: 200,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        estimated_cost_usd: null,
        input_rate_usd_per_million: null,
        output_rate_usd_per_million: null,
      })
      expect(JSON.stringify(insertMock.mock.calls)).not.toContain(apiKey)
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('registra separatamente il fallimento e il retry manuale nel flusso di validazione credenziali', async () => {
    const ownerId = 'retry-flow-owner'
    const apiKey = 'test-youtube-key-for-manual-retry'
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    let credentialRow: Record<string, unknown> | null = null
    const selectQuery = {
      eq: vi.fn(() => selectQuery),
      maybeSingle: vi.fn(async () => ({ data: credentialRow, error: null })),
    }
    let updateFilterCount = 0
    const updateQuery = {
      eq: vi.fn(() => {
        updateFilterCount += 1
        return updateFilterCount % 2 === 0 ? Promise.resolve({ error: null }) : updateQuery
      }),
    }
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => selectQuery),
        upsert: vi.fn(async (values: Record<string, unknown>) => {
          credentialRow = { id: 'credential-retry', ...values }
          return { error: null }
        }),
        update: vi.fn((values: Record<string, unknown>) => {
          credentialRow = { ...(credentialRow ?? {}), ...values }
          return updateQuery
        }),
      })),
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    vi.stubGlobal('fetch', fetchMock)
    createClientMock.mockResolvedValue(supabase)

    try {
      getCurrentSessionMock.mockResolvedValue({ userId: ownerId })
      const post = (body: Record<string, string>) => postIntegrations(new Request('http://localhost/api/integrations', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))
      const firstResponse = await post({ provider: 'youtube', apiKey, action: 'save' })
      const firstAttempt = await firstResponse.json()
      const retryResponse = await post({ provider: 'youtube', action: 'validate' })
      const retry = await retryResponse.json()

      expect(firstResponse.status).toBe(200)
      expect(firstAttempt.data.isValid).toBe(false)
      expect(retryResponse.status).toBe(200)
      expect(retry.data).toMatchObject({ provider: 'youtube', isValid: true, message: null })
      expect(getCurrentSessionMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/youtube/v3/search',
        '/youtube/v3/search',
      ])

      const insertedRows = insertMock.mock.calls.map(([row]) => row as Record<string, unknown>)
      expect(insertedRows.filter((row) => row.provider === 'youtube')).toMatchObject([
        { user_id: ownerId, operation: 'search.list', outcome: 'http_error', http_status: 503, quota_units: 1 },
        { user_id: ownerId, operation: 'search.list', outcome: 'success', http_status: 200, quota_units: 1 },
      ])
      expect(insertedRows.filter((row) => 'credential_id' in row)).toMatchObject([
        { credential_id: 'credential-retry', is_valid: false },
        { credential_id: 'credential-retry', is_valid: true, error_type: null },
      ])
      expect(credentialRow).toMatchObject({ user_id: ownerId, is_valid: true })
      expect(JSON.stringify(insertMock.mock.calls)).not.toContain(apiKey)
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('ritenta errori temporanei Gemini solo sulla GET idempotente e registra ogni tentativo', async () => {
    const ownerId = 'gemini-retry-owner'
    const apiKey = 'test-gemini-key-for-retry'
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase } = createCredentialSupabase('credential-gemini-retry')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await saveApiKey({
        userId: ownerId,
        provider: 'gemini',
        apiKey,
        supabase: supabase as unknown as AppSupabaseClient,
      })

      expect(result.isValid).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
      expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true)
      expect(insertMock.mock.calls
        .map(([row]) => row as Record<string, unknown>)
        .filter((row) => row.provider === 'gemini')).toMatchObject([
        { provider: 'gemini', outcome: 'network_error' },
        { provider: 'gemini', outcome: 'http_error', http_status: 503 },
        { provider: 'gemini', outcome: 'success', http_status: 200 },
      ])
      expect(JSON.stringify(insertMock.mock.calls)).not.toContain(apiKey)
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })

  it('non ritenta gli errori Gemini 429/quota', async () => {
    const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY
    const { supabase } = createCredentialSupabase('credential-gemini-quota')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }))

    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-encryption-key'
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await saveApiKey({
        userId: 'gemini-quota-owner',
        provider: 'gemini',
        apiKey: 'test-gemini-key-for-quota',
        supabase: supabase as unknown as AppSupabaseClient,
      })

      expect(result.isValid).toBe(false)
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET')
      expect(insertMock.mock.calls
        .map(([row]) => row as Record<string, unknown>)
        .filter((row) => row.provider === 'gemini')).toMatchObject([
        { provider: 'gemini', outcome: 'http_error', http_status: 429 },
      ])
    } finally {
      vi.unstubAllGlobals()
      if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
      else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    }
  })
})
