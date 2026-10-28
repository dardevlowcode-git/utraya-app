import { describe, expect, it, vi } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import { getAdminRetryLimits, setCredentialRetryLimit, setSharedYoutubeRetryLimit } from '@/lib/services/retry-limits'

const credentialId = '00000000-0000-4000-8000-000000000001'
const missingRetryId = '00000000-0000-4000-8000-000000000002'

function createAdminDatabase() {
  const credentialRows = [
    { id: credentialId, user_id: 'user-1', provider: 'youtube', is_configured: true },
    { id: missingRetryId, user_id: 'user-2', provider: 'gemini', is_configured: false },
  ]
  const retryLimitUpsert = vi.fn(async () => ({ error: null }))
  const sharedUpsert = vi.fn(async () => ({ error: null }))
  const selectCalls: Array<{ table: string; columns: string }> = []

  const from = vi.fn((table: string) => ({
    select: vi.fn((columns: string) => {
      selectCalls.push({ table, columns })
      if (table === 'user_provider_credentials') {
        return {
          order: vi.fn(async () => ({ data: credentialRows, error: null })),
          eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: credentialId }, error: null })) })),
        }
      }
      if (table === 'users') {
        return {
          in: vi.fn(async () => ({
            data: [
              { id: 'user-1', display_name: 'Dario', email: 'dario@example.test' },
              { id: 'user-2', display_name: null, email: 'utente@example.test' },
            ],
            error: null,
          })),
        }
      }
      if (table === 'user_provider_credential_retry_limits') {
        return {
          in: vi.fn(async () => ({
            data: [{ credential_id: credentialId, retry_limit: 1 }],
            error: null,
          })),
        }
      }
      return {
        eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
      }
    }),
    upsert: table === 'user_provider_credential_retry_limits' ? retryLimitUpsert : sharedUpsert,
    eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: credentialId }, error: null })) })),
  }))

  return {
    admin: { from } as unknown as ReturnType<typeof createAdminClient>,
    from,
    retryLimitUpsert,
    sharedUpsert,
    selectCalls,
  }
}

describe('retry-limits service', () => {
  it('mostra default 0 privati e 10 condivisi senza selezionare ciphertext', async () => {
    const { admin, selectCalls } = createAdminDatabase()

    const result = await getAdminRetryLimits(admin)

    expect(result.credentials).toEqual([
      {
        credentialId,
        provider: 'youtube',
        owner: 'Dario',
        isConfigured: true,
        retryLimit: 1,
        maxAttempts: 2,
      },
      {
        credentialId: missingRetryId,
        provider: 'gemini',
        owner: 'utente@example.test',
        isConfigured: false,
        retryLimit: 0,
        maxAttempts: 1,
      },
    ])
    expect(result.sharedYoutube).toMatchObject({ retryLimit: 10, maxAttempts: 11, active: false })
    expect(selectCalls.find((call) => call.table === 'user_provider_credentials')?.columns)
      .toBe('id, user_id, provider, is_configured')
    expect(JSON.stringify(result)).not.toContain('encrypted_key')
  })

  it('persiste il limite privato solo con id credenziale e limite', async () => {
    const { admin, retryLimitUpsert } = createAdminDatabase()

    const result = await setCredentialRetryLimit(admin, credentialId, 10)

    expect(result).toEqual({ credentialId, retryLimit: 10 })
    expect(retryLimitUpsert).toHaveBeenCalledWith({ credential_id: credentialId, retry_limit: 10 })
  })

  it('mantiene il setting YouTube condiviso separato e senza modificare le env', async () => {
    const { admin, sharedUpsert } = createAdminDatabase()

    const result = await setSharedYoutubeRetryLimit(admin, 0)

    expect(result).toEqual({ providerKey: 'youtube_innertube', retryLimit: 0 })
    expect(sharedUpsert).toHaveBeenCalledWith({ provider_key: 'youtube_innertube', retry_limit: 0 })
  })

  it.each([-1, 1.5, 2147483648])('rifiuta il valore non rappresentabile %s anche fuori dalla route', async (retryLimit) => {
    const { admin, retryLimitUpsert } = createAdminDatabase()

    await expect(setCredentialRetryLimit(admin, credentialId, retryLimit)).rejects.toThrow('intero non negativo')
    expect(retryLimitUpsert).not.toHaveBeenCalled()
  })
})
