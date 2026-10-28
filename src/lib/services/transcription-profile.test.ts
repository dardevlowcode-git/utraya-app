import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getKeyMock, createAdminClientMock } = vi.hoisted(() => ({ getKeyMock: vi.fn(), createAdminClientMock: vi.fn() }))
vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: getKeyMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import {
  filterTranscriptionModels,
  getThinkingLevelsForModel,
  isThinkingLevelValidForModel,
  isValidPrice,
  listGeminiModels,
  updateTranscriptionProfile,
} from '@/lib/services/transcription-profile'

const usageInsert = vi.fn(async () => ({ error: null }))
const rpc = vi.fn()
let credentialRows: Array<{ user_id: string; is_valid: boolean | null }> = []
let profileRow: Record<string, unknown> | null = null

/** Query finta concatenabile: ogni metodo restituisce la stessa query, `await` produce il risultato. */
function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'order', 'limit']) q[name] = () => q
  q.maybeSingle = async () => result
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return q
}

function fakeAdmin() {
  return {
    from: (table: string) => {
      if (table === 'user_provider_credentials') return query({ data: credentialRows, error: null })
      if (table === 'transcription_profile') return query({ data: profileRow, error: null })
      if (table === 'api_usage_events') return { insert: usageInsert }
      throw new Error(`tabella inattesa ${table}`)
    },
    rpc,
  }
}

const googleModels = {
  models: [
    { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-live-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-native-audio', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/lyria-3', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/deep-research-pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3-nano-banana', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemma-3-27b', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-no-methods' },
  ],
}

describe('profilo di trascrizione: regole pure', () => {
  it('filtra solo modelli Gemini testuali con generateContent', () => {
    expect(filterTranscriptionModels(googleModels.models)).toEqual(['gemini-2.5-flash', 'gemini-3.1-flash-lite'])
  })

  it('accetta solo livelli validi per la famiglia', () => {
    expect(getThinkingLevelsForModel('gemini-2.5-flash')).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(isThinkingLevelValidForModel('gemini-3.1-flash-lite', 'medium')).toBe(true)
    expect(isThinkingLevelValidForModel('gemini-3.1-flash-lite', 'extreme')).toBe(false)
    expect(isThinkingLevelValidForModel('gemini-2.5-flash', 'budget')).toBe(false)
  })

  it('valida i prezzi: >= 0 e al massimo 6 decimali', () => {
    expect([0, 0.25, 1.5, 0.000001, 12.345678].every(isValidPrice)).toBe(true)
    expect([-0.1, 0.0000001, 1.1234567, Number.NaN, Infinity, 1_000_000].some(isValidPrice)).toBe(false)
  })
})

describe('elenco modelli da Google', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    credentialRows = [{ user_id: 'bad-owner', is_valid: false }, { user_id: 'owner-1', is_valid: true }, { user_id: 'owner-2', is_valid: null }]
    createAdminClientMock.mockReturnValue(fakeAdmin())
    getKeyMock.mockResolvedValue('secret-key')
  })

  it('usa la prima chiave valida, filtra i modelli e registra l’uso sul proprietario senza esporre la chiave', async () => {
    const fetcher = vi.fn(async () => Response.json(googleModels))
    const result = await listGeminiModels(fakeAdmin() as never, fetcher as never)

    expect(result).toEqual({ status: 'ok', models: ['gemini-2.5-flash', 'gemini-3.1-flash-lite'] })
    expect(getKeyMock).toHaveBeenCalledTimes(1)
    expect(getKeyMock).toHaveBeenCalledWith('owner-1', 'gemini')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models?')
    expect(url).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    expect(usageInsert).toHaveBeenCalledTimes(1)
    const event = usageInsert.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(event[0]).toMatchObject({ user_id: 'owner-1', provider: 'gemini', operation: 'models.list', outcome: 'success', http_status: 200 })
    expect(JSON.stringify(event[0])).not.toContain('secret-key')
  })

  it('segue la paginazione di Google', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ models: googleModels.models.slice(0, 1), nextPageToken: 'next' }))
      .mockResolvedValueOnce(Response.json({ models: googleModels.models.slice(1, 2) }))
    const result = await listGeminiModels(fakeAdmin() as never, fetcher as never)

    expect(result).toEqual({ status: 'ok', models: ['gemini-2.5-flash', 'gemini-3.1-flash-lite'] })
    expect((fetcher.mock.calls[1] as unknown as [string])[0]).toContain('pageToken=next')
  })

  it('senza chiavi valide restituisce no_key e non chiama Google', async () => {
    credentialRows = [{ user_id: 'bad-owner', is_valid: false }]
    const fetcher = vi.fn()

    expect(await listGeminiModels(fakeAdmin() as never, fetcher as never)).toEqual({ status: 'no_key' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(usageInsert).not.toHaveBeenCalled()
  })

  it('prova la chiave successiva se la prima non si decifra o è rifiutata', async () => {
    getKeyMock.mockResolvedValueOnce(null).mockResolvedValueOnce('second-key')
    const fetcher = vi.fn(async () => Response.json(googleModels))
    const result = await listGeminiModels(fakeAdmin() as never, fetcher as never)

    expect(result.status).toBe('ok')
    expect(getKeyMock).toHaveBeenNthCalledWith(2, 'owner-2', 'gemini')

    getKeyMock.mockReset().mockResolvedValue('k')
    const rejecting = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockResolvedValueOnce(Response.json(googleModels))
    expect((await listGeminiModels(fakeAdmin() as never, rejecting as never)).status).toBe('ok')
  })

  it('un errore del provider restituisce error e resta nel registro uso', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 503 }))

    expect(await listGeminiModels(fakeAdmin() as never, fetcher as never)).toEqual({ status: 'error' })
    expect(usageInsert.mock.calls[0]).toBeDefined()
    expect((usageInsert.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({
      operation: 'models.list', outcome: 'http_error', http_status: 503, user_id: 'owner-1',
    })
  })

  it('un errore di rete restituisce error', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    expect(await listGeminiModels(fakeAdmin() as never, fetcher as never)).toEqual({ status: 'error' })
  })
})

describe('salvataggio profilo', () => {
  const current = { model: 'gemini-3.1-flash-lite', thinking_level: 'minimal', input_price_per_million: 0.25, output_price_per_million: 1.5 }
  const input = { model: 'gemini-3.1-flash-lite', thinkingLevel: 'low' as const, inputPricePerMillion: 0.3, outputPricePerMillion: 2 }

  beforeEach(() => {
    vi.clearAllMocks()
    credentialRows = [{ user_id: 'owner-1', is_valid: true }]
    profileRow = current
    getKeyMock.mockResolvedValue('secret-key')
    createAdminClientMock.mockReturnValue(fakeAdmin())
    rpc.mockResolvedValue({
      data: [{ model: 'gemini-3.1-flash-lite', thinking_level: 'low', input_price_per_million: '0.3', output_price_per_million: '2' }],
      error: null,
    })
  })

  it('salva prezzi e livello del modello corrente anche senza elenco modelli e passa l’admin all’audit', async () => {
    credentialRows = []
    const fetcher = vi.fn()
    const result = await updateTranscriptionProfile(fakeAdmin() as never, input, 'admin', fetcher as never)

    expect(result).toEqual({ ok: true, profile: { model: 'gemini-3.1-flash-lite', thinkingLevel: 'low', inputPricePerMillion: 0.3, outputPricePerMillion: 2 } })
    expect(fetcher).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('update_transcription_profile', {
      p_model: 'gemini-3.1-flash-lite', p_thinking_level: 'low', p_input_price: 0.3, p_output_price: 2, p_admin_username: 'admin',
    })
  })

  it('rifiuta un livello non valido per il modello prima di salvare', async () => {
    const result = await updateTranscriptionProfile(fakeAdmin() as never, { ...input, thinkingLevel: 'extreme' as never }, 'admin')

    expect(result).toEqual({ ok: false, code: 'INVALID_LEVEL' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rifiuta il cambio modello se l’elenco non è disponibile', async () => {
    credentialRows = []
    const result = await updateTranscriptionProfile(fakeAdmin() as never, { ...input, model: 'gemini-2.5-flash' }, 'admin', vi.fn() as never)

    expect(result).toEqual({ ok: false, code: 'MODELS_UNAVAILABLE' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rifiuta un modello fuori elenco e accetta uno presente', async () => {
    const fetcher = vi.fn(async () => Response.json(googleModels))
    expect(await updateTranscriptionProfile(fakeAdmin() as never, { ...input, model: 'gemini-9-ghost' }, 'admin', fetcher as never))
      .toEqual({ ok: false, code: 'MODEL_NOT_LISTED' })
    expect(rpc).not.toHaveBeenCalled()

    const ok = await updateTranscriptionProfile(fakeAdmin() as never, { ...input, model: 'gemini-2.5-flash' }, 'admin', fetcher as never)
    expect(ok.ok).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('un errore della RPC non espone dettagli', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(updateTranscriptionProfile(fakeAdmin() as never, input, 'admin')).rejects.toThrow('Impossibile salvare il profilo di trascrizione')
  })
})
