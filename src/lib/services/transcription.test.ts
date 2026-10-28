import { beforeEach, describe, expect, it, vi } from 'vitest'

const { usageRows } = vi.hoisted(() => ({ usageRows: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        usageRows.push(row)
        return { error: null }
      },
    }),
  }),
}))

import {
  buildTranscriptionParts,
  checkBlockPhrases,
  runTranscriptionJob,
  type GeminiCredential,
  type PhraseToSave,
  type SavePartInput,
  type TranscriptionContext,
  type TranscriptionPartState,
  type TranscriptionStatus,
  type TranscriptionStore,
  type TranscriptionWorkerDeps,
} from '@/lib/services/transcription'

const JOB_ID = 'job-1'
const OWNER = 'owner-1'

interface FakeStoreState {
  context: TranscriptionContext
  phrases: Map<number, PhraseToSave[]>
  languageCode: string | null
  jobStatus: 'pending' | 'running' | 'completed' | 'failed'
  jobError: string | null
  finalStatus: TranscriptionStatus | null
  closedPending: boolean
  saves: SavePartInput[]
}

/** Store in memoria che riproduce la semantica delle RPC (salvataggio per parte, finalizzazione, lease). */
function createFakeStore(options: {
  durationSeconds?: number
  credential?: GeminiCredential | null
  status?: TranscriptionStatus
  parts?: TranscriptionPartState[]
  model?: string
  loseLeaseOnSave?: boolean
} = {}) {
  const parts = options.parts
    ?? buildTranscriptionParts(options.durationSeconds ?? 300).map((part) => ({
      ...part, status: 'pending' as const, attempts: 0, lastError: null,
    }))
  const state: FakeStoreState = {
    context: {
      transcriptionId: 'tr-1',
      status: options.status ?? 'pending',
      youtubeVideoId: 'abcdefghijk',
      model: options.model ?? 'gemini-3.1-flash-lite',
      thinkingLevel: 'minimal',
      inputPricePerMillion: 0.25,
      outputPricePerMillion: 1.5,
      parts,
    },
    phrases: new Map(),
    languageCode: null,
    jobStatus: 'pending',
    jobError: null,
    finalStatus: null,
    closedPending: false,
    saves: [],
  }
  const credential = options.credential === undefined
    ? { ownerUserId: OWNER, apiKey: 'synthetic-key', retryLimit: 0 }
    : options.credential

  const store: TranscriptionStore = {
    async claimJob() {
      state.jobStatus = 'running'
      return {
        attemptId: 'attempt-1',
        payload: { videoId: 'video-1', transcriptionId: 'tr-1', requestedByUserId: OWNER, credentialOwnerUserId: OWNER, channelId: null },
      }
    },
    async loadContext() {
      return { ...state.context, parts: state.context.parts.map((part) => ({ ...part })) }
    },
    async loadCredential() {
      return { credential, channelId: null }
    },
    async acquireChannelCredential() {
      throw new Error('richieste manuali: nessuna rotazione')
    },
    async claimPartCredential() {
      throw new Error('richieste manuali: nessuna rotazione')
    },
    async recordPartKeyExhausted() {
      throw new Error('richieste manuali: nessuna rotazione')
    },
    async savePart(input) {
      state.saves.push(input)
      if (options.loseLeaseOnSave) return false
      const part = state.context.parts.find((item) => item.position === input.partPosition)!
      part.status = input.status
      part.attempts = input.attempts
      part.lastError = input.lastError
      if (input.status === 'done') state.phrases.set(input.partPosition, input.phrases ?? [])
      state.languageCode = state.languageCode ?? input.languageCode
      return true
    },
    async finalize(input) {
      if (input.closePending) {
        state.closedPending = true
        for (const part of state.context.parts) if (part.status === 'pending') part.status = 'missing'
      }
      if (state.context.parts.some((part) => part.status === 'pending')) return 'running'
      const doubtful = [...state.phrases.values()].flat().some((phrase) => phrase.doubtful_time)
      const missing = state.context.parts.some((part) => part.status === 'missing')
      state.finalStatus = missing || doubtful ? 'needs_review' : 'complete'
      return state.finalStatus
    },
    async finishJob(input) {
      state.jobStatus = input.status
      state.jobError = input.errorMessage
      return true
    },
  }
  return { store, state }
}

/** Risposta Gemini sintetica con segmenti `{start, text}` e conteggi token. */
function geminiResponse(segments: Array<{ start: string; text: string }>, language = 'it', usage = { prompt: 1000, output: 100 }) {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ language, segments }) }] } }],
    usageMetadata: {
      promptTokenCount: usage.prompt,
      candidatesTokenCount: usage.output,
      totalTokenCount: usage.prompt + usage.output,
    },
  })
}

function deps(store: TranscriptionStore, fetcher: typeof fetch, extra: Partial<TranscriptionWorkerDeps> = {}): TranscriptionWorkerDeps {
  return { store, fetcher, sleep: async () => undefined, concurrency: 1, ...extra }
}

function requestBodies(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string))
}

describe('servizio di trascrizione', () => {
  beforeEach(() => {
    usageRows.length = 0
  })

  it('trascrive per blocchi da 120 s con la ricetta fissa e salva frasi e lingua', async () => {
    const { store, state } = createFakeStore({ durationSeconds: 300 })
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      const start = Number(body.contents[0].parts[0].videoMetadata.startOffset.replace('s', ''))
      const mm = String(Math.floor(start / 60)).padStart(2, '0')
      return geminiResponse([{ start: `${mm}:05`, text: `frase sintetica ${start}` }, { start: `${mm}:40`, text: `altra frase ${start}` }])
    })

    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))

    expect(result).toEqual({ outcome: 'complete', partsSaved: 3 })
    const bodies = requestBodies(fetcher)
    expect(bodies.map((body) => body.contents[0].parts[0].videoMetadata)).toEqual([
      { startOffset: '0s', endOffset: '120s' },
      { startOffset: '120s', endOffset: '240s' },
      { startOffset: '240s', endOffset: '300s' },
    ])
    expect(bodies[0].contents[0].parts[0].fileData.fileUri).toBe('https://www.youtube.com/watch?v=abcdefghijk')
    expect(bodies[0].generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      temperature: 0,
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
      thinkingConfig: { thinkingLevel: 'minimal' },
    })
    expect(bodies[0].generationConfig.responseSchema.properties.segments.items.properties.start.type).toBe('STRING')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('synthetic-key')
    expect(url).not.toContain('synthetic-key')

    expect(state.phrases.get(1)).toEqual([
      { idx: 0, start_seconds: 125, text: 'frase sintetica 120', doubtful_time: false },
      { idx: 1, start_seconds: 160, text: 'altra frase 120', doubtful_time: false },
    ])
    expect(state.languageCode).toBe('it')
    expect(state.finalStatus).toBe('complete')
    expect(state.jobStatus).toBe('completed')
  })

  it('usa il budget di thinking per i modelli 2.5', async () => {
    const { store } = createFakeStore({ durationSeconds: 100, model: 'gemini-2.5-flash-lite' })
    const fetcher = vi.fn(async () => geminiResponse([{ start: '00:03', text: 'ciao' }]))
    await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))
    expect(requestBodies(fetcher)[0].generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
  })

  it('conserva le frasi fuori blocco, all’indietro o con tempo illeggibile e segna la trascrizione da rivedere', async () => {
    const { store, state } = createFakeStore({ durationSeconds: 120 })
    const fetcher = vi.fn(async () => geminiResponse([
      { start: '00:10', text: 'prima' },
      { start: '00:05', text: 'all indietro' },
      { start: '03:30', text: 'fuori blocco' },
      { start: '??', text: 'tempo illeggibile' },
      { start: '00:50', text: 'regolare dopo gli anomali' },
      { start: '00:52', text: '   ' },
    ]))

    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))

    expect(result.outcome).toBe('needs_review')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(state.phrases.get(0)).toEqual([
      { idx: 0, start_seconds: 10, text: 'prima', doubtful_time: false },
      { idx: 1, start_seconds: 5, text: 'all indietro', doubtful_time: true },
      { idx: 2, start_seconds: 210, text: 'fuori blocco', doubtful_time: true },
      { idx: 3, start_seconds: 10, text: 'tempo illeggibile', doubtful_time: true },
      { idx: 4, start_seconds: 50, text: 'regolare dopo gli anomali', doubtful_time: false },
    ])
  })

  it('accetta frasi entro 2 secondi dal blocco', () => {
    const phrases = checkBlockPhrases(
      [{ start: '01:58', text: 'a' }, { start: '04:02', text: 'b' }, { start: '04:03', text: 'c' }],
      { startSeconds: 120, endSeconds: 240 }
    )
    expect(phrases.map((phrase) => phrase.doubtful_time)).toEqual([false, false, true])
  })

  it('con limite retry 0 un errore provider lascia la parte mancante e la trascrizione da rivedere', async () => {
    const { store, state } = createFakeStore({ durationSeconds: 240 })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(geminiResponse([{ start: '00:01', text: 'ok' }]))
      .mockResolvedValueOnce(new Response('errore', { status: 500 }))

    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))

    expect(result.outcome).toBe('needs_review')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(state.context.parts.map((part) => [part.status, part.attempts, part.lastError])).toEqual([
      ['done', 1, null],
      ['missing', 1, 'provider_http_500'],
    ])
    expect(state.finalStatus).toBe('needs_review')
  })

  it('richiesta manuale: un errore su una parte non ferma le altre, solo quella parte resta mancante', async () => {
    const { store, state } = createFakeStore({ durationSeconds: 360 })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockImplementation(async () => geminiResponse([{ start: '00:10', text: 'frase sintetica' }]))

    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))

    expect(result.outcome).toBe('needs_review')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(state.context.parts.map((part) => part.status)).toEqual(['missing', 'done', 'done'])
    expect(state.closedPending).toBe(false)
  })

  it('con limite retry 1 ritenta lo stesso blocco una volta e poi lo dichiara mancante', async () => {
    const credential = { ownerUserId: OWNER, apiKey: 'k', retryLimit: 1 }
    const recovered = createFakeStore({ durationSeconds: 120, credential })
    const flaky = vi.fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(geminiResponse([{ start: '00:02', text: 'riuscita al secondo tentativo' }]))
    expect((await runTranscriptionJob(JOB_ID, deps(recovered.store, flaky as unknown as typeof fetch))).outcome).toBe('complete')
    expect(flaky).toHaveBeenCalledTimes(2)
    expect(recovered.state.context.parts[0]).toMatchObject({ status: 'done', attempts: 2 })

    const exhausted = createFakeStore({ durationSeconds: 120, credential })
    const failing = vi.fn(async () => new Response('x', { status: 500 }))
    const sleep = vi.fn(async () => undefined)
    const result = await runTranscriptionJob(JOB_ID, deps(exhausted.store, failing as unknown as typeof fetch, { sleep }))
    expect(result.outcome).toBe('needs_review')
    expect(failing).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(exhausted.state.context.parts[0]).toMatchObject({ status: 'missing', attempts: 2, lastError: 'provider_http_500' })
  })

  it('ritenta i JSON illeggibili e i timeout secondo il limite della chiave', async () => {
    const credential = { ownerUserId: OWNER, apiKey: 'k', retryLimit: 2 }
    const { store, state } = createFakeStore({ durationSeconds: 120, credential })
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: 'non è json' }] } }] }))
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(geminiResponse([{ start: '00:02', text: 'finalmente' }]))

    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))

    expect(result.outcome).toBe('complete')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(state.context.parts[0]).toMatchObject({ status: 'done', attempts: 3 })
    expect(usageRows.map((row) => row.outcome)).toEqual(['success', 'timeout', 'success'])
  })

  it('riusa una trascrizione già disponibile senza chiamare il provider', async () => {
    for (const status of ['complete', 'needs_review'] as const) {
      const { store, state } = createFakeStore({ status })
      const fetcher = vi.fn()
      const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))
      expect(result.outcome).toBe('reused')
      expect(fetcher).not.toHaveBeenCalled()
      expect(state.jobStatus).toBe('completed')
    }
    expect(usageRows).toHaveLength(0)
  })

  it('registra ogni tentativo nel registro uso del proprietario della chiave con modello, token e tariffe del profilo', async () => {
    const { store } = createFakeStore({ durationSeconds: 240, credential: { ownerUserId: OWNER, apiKey: 'k', retryLimit: 1 } })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(geminiResponse([{ start: '00:01', text: 'a' }], 'it', { prompt: 11_000, output: 200 }))
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValueOnce(geminiResponse([{ start: '02:01', text: 'b' }], 'it', { prompt: 11_000, output: 200 }))

    await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))

    expect(usageRows).toHaveLength(3)
    expect(usageRows[0]).toMatchObject({
      user_id: OWNER,
      provider: 'gemini',
      operation: 'generateContent.transcribe',
      model: 'gemini-3.1-flash-lite',
      outcome: 'success',
      input_tokens: 11_000,
      output_tokens: 200,
      total_tokens: 11_200,
      input_rate_usd_per_million: 0.25,
      output_rate_usd_per_million: 1.5,
      estimated_cost_usd: 0.00305,
    })
    expect(usageRows[1]).toMatchObject({ user_id: OWNER, outcome: 'http_error', http_status: 500, input_tokens: null })
    expect(JSON.stringify(usageRows)).not.toContain('synthetic')
  })

  it('riprende dopo un’interruzione senza ripetere i blocchi già fatti', async () => {
    const parts = buildTranscriptionParts(360).map((part, index) => ({
      ...part,
      status: index === 0 ? ('done' as const) : ('pending' as const),
      attempts: index === 0 ? 1 : 0,
      lastError: null,
    }))
    const { store } = createFakeStore({ parts })
    const fetcher = vi.fn(async () => geminiResponse([{ start: '02:10', text: 'ripresa' }]))

    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))

    expect(result.partsSaved).toBe(2)
    expect(requestBodies(fetcher).map((body) => body.contents[0].parts[0].videoMetadata.startOffset)).toEqual(['120s', '240s'])
  })

  it('rilascia la lease a budget finito, chiede la continuazione e la ripresa copre solo le parti rimaste', async () => {
    const { store, state } = createFakeStore({ durationSeconds: 360 })
    let clock = 0
    const fetcher = vi.fn(async () => {
      clock += 100_000
      return geminiResponse([{ start: '00:01', text: 'x' }])
    })
    const requestContinuation = vi.fn(async () => undefined)
    const budget = { now: () => clock, softBudgetMs: 150_000, hardBudgetMs: 250_000, requestContinuation }

    const first = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch, budget))
    expect(first.outcome).toBe('yielded')
    expect(first.partsSaved).toBe(2)
    expect(state.jobStatus).toBe('pending')
    expect(requestContinuation).toHaveBeenCalledWith(JOB_ID)
    expect(state.context.parts.map((part) => part.status)).toEqual(['done', 'done', 'pending'])

    clock = 0
    const second = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch, budget))
    expect(second.outcome).toBe('needs_review')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('non avvia nuovi tentativi oltre il budget massimo e lascia la parte pending', async () => {
    const credential = { ownerUserId: OWNER, apiKey: 'k', retryLimit: 5 }
    const { store, state } = createFakeStore({ durationSeconds: 120, credential })
    let clock = 0
    const fetcher = vi.fn(async () => {
      clock += 120_000
      return new Response('x', { status: 500 })
    })
    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch, {
      now: () => clock, hardBudgetMs: 250_000, callTimeoutMs: 60_000, softBudgetMs: 170_000,
    }))
    expect(result.outcome).toBe('yielded')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(state.context.parts[0]).toMatchObject({ status: 'pending', attempts: 2 })
  })

  it('limita la concorrenza ai blocchi in parallelo richiesti', async () => {
    const { store } = createFakeStore({ durationSeconds: 120 * 8 })
    let inFlight = 0
    let peak = 0
    const fetcher = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return geminiResponse([{ start: '00:01', text: 'p' }])
    })
    await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch, { concurrency: 4 }))
    expect(peak).toBe(4)
    expect(fetcher).toHaveBeenCalledTimes(8)
  })

  it('senza chiave utilizzabile chiude le parti come mancanti e fallisce il job senza chiamare Gemini', async () => {
    const { store, state } = createFakeStore({ credential: null })
    const fetcher = vi.fn()
    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))
    expect(result.outcome).toBe('failed')
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.closedPending).toBe(true)
    expect(state.jobStatus).toBe('failed')
    expect(state.jobError).toBe('credential_unavailable')
  })

  it('si ferma senza altre scritture se la lease è stata persa', async () => {
    const { store, state } = createFakeStore({ durationSeconds: 360, loseLeaseOnSave: true })
    const fetcher = vi.fn(async () => geminiResponse([{ start: '00:01', text: 'x' }]))
    const result = await runTranscriptionJob(JOB_ID, deps(store, fetcher as unknown as typeof fetch))
    expect(result.outcome).toBe('lease_lost')
    expect(state.jobStatus).toBe('running')
    expect(state.finalStatus).toBeNull()
  })

  it('divide la durata in parti da 120 s con ultima parte più corta', () => {
    expect(buildTranscriptionParts(250)).toEqual([
      { position: 0, startSeconds: 0, endSeconds: 120 },
      { position: 1, startSeconds: 120, endSeconds: 240 },
      { position: 2, startSeconds: 240, endSeconds: 250 },
    ])
    expect(buildTranscriptionParts(90 * 60)).toHaveLength(45)
  })
})

describe('P5: chiave del richiedente non più eleggibile', () => {
  /** Con owner nel payload ma `loadCredential` null e canale noto, il job ricade sulla rotazione del canale. */
  function createRequesterRerouteStore() {
    const parts = buildTranscriptionParts(240).map((part) => ({
      ...part, status: 'pending' as 'pending' | 'done' | 'missing', attempts: 0, lastError: null as string | null,
    }))
    const context: TranscriptionContext = {
      transcriptionId: 'tr-1', status: 'pending', youtubeVideoId: 'abcdefghijk',
      model: 'gemini-3.1-flash-lite', thinkingLevel: 'minimal',
      inputPricePerMillion: 0.25, outputPricePerMillion: 1.5, parts,
    }
    const acquired: string[] = []
    const state = { jobStatus: 'pending', jobError: null as string | null }
    const store: TranscriptionStore = {
      async claimJob() {
        state.jobStatus = 'running'
        return { attemptId: 'a', payload: { videoId: 'video-1', transcriptionId: 'tr-1', requestedByUserId: OWNER, credentialOwnerUserId: OWNER, channelId: null } }
      },
      async loadContext() { return { ...context, parts: parts.map((part) => ({ ...part })) } },
      async loadCredential(input) {
        expect(input).toEqual({ ownerUserId: OWNER, channelId: null, videoId: 'video-1' })
        return { credential: null, channelId: 'channel-1' } as never
      },
      async acquireChannelCredential(input) {
        acquired.push(input.channelId)
        return { status: 'assigned', credential: { ownerUserId: 'follower', apiKey: 'key-follower', retryLimit: 0, credentialId: 'c-f', keyVersion: 'k-f' } }
      },
      async claimPartCredential() { throw new Error('non usato') },
      async recordPartKeyExhausted() { throw new Error('non usato') },
      async savePart(input) {
        parts.find((part) => part.position === input.partPosition)!.status = input.status
        return true
      },
      async finalize() { return parts.some((p) => p.status === 'missing') ? 'needs_review' : 'complete' },
      async finishJob(input) { state.jobStatus = input.status; state.jobError = input.errorMessage; return true },
    }
    return { store, state, acquired }
  }

  it('un vecchio job senza channelId ricava il canale e ruota se il richiedente non è più follower', async () => {
    const { store, state, acquired } = createRequesterRerouteStore()
    const headers: Array<Record<string, string>> = []
    const fetcher = vi.fn(async (_url: unknown, init: unknown) => {
      headers.push((init as RequestInit).headers as Record<string, string>)
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ language: 'it', segments: [{ start: '00:01', text: 'frase' }] }) }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      })
    })

    const result = await runTranscriptionJob(JOB_ID, {
      store, fetcher: fetcher as unknown as typeof fetch, sleep: async () => undefined, concurrency: 1,
    })

    expect(result.outcome).toBe('complete')
    expect(acquired).toEqual(['channel-1'])
    expect(headers.every((header) => header['x-goog-api-key'] === 'key-follower')).toBe(true)
    expect(state.jobStatus).toBe('completed')
  })
})
