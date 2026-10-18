/* Commento didattico:
 * Scopo del file: verifica il comportamento del worker sui job automatici con chiavi in rotazione per canale.
 * Moduli richiamati: `vitest`, servizio di trascrizione, registratore uso (client admin finto che raccoglie gli eventi).
 * Flusso: uno store in memoria assegna le chiavi in ordine come l'RPC (la rotazione reale per canale è provata su PostgreSQL);
 * qui si controllano retry sulla stessa chiave, passaggio alla successiva per sola parte, esaurimento, attesa e attribuzione dell'uso.
 */

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
  runTranscriptionJob,
  type ChannelCredentialAcquisition,
  type GeminiCredential,
  type PartCredentialAcquisition,
  type TranscriptionContext,
  type TranscriptionStore,
  type TranscriptionWorkerDeps,
} from '@/lib/services/transcription'

const CHANNEL = 'channel-1'

function key(owner: string, retryLimit = 0): GeminiCredential {
  return { ownerUserId: owner, apiKey: `key-${owner}`, retryLimit, credentialId: `cred-${owner}`, keyVersion: `ver-${owner}` }
}

/**
 * Store in memoria di un job automatico: `eligible` è la lista ordinata delle chiavi del canale; ogni chiave
 * viene assegnata una sola volta per job (come `transcription_job_credentials`) e quella attiva resta fissa.
 */
function createAutoStore(options: { durationSeconds?: number; eligible: GeminiCredential[] }) {
  const parts = buildTranscriptionParts(options.durationSeconds ?? 360).map((part) => ({
    ...part, status: 'pending' as 'pending' | 'done' | 'missing', attempts: 0, lastError: null as string | null,
  }))
  const context: TranscriptionContext = {
    transcriptionId: 'tr-1', status: 'pending', youtubeVideoId: 'abcdefghijk',
    model: 'gemini-3.1-flash-lite', thinkingLevel: 'minimal', inputPricePerMillion: 0.25, outputPricePerMillion: 1.5, parts,
  }
  const recorded: Array<{ owner: string; partPosition: number; lastError: string | null }> = []
  const state = { jobStatus: 'pending', jobError: null as string | null, finalStatus: null as string | null, closedPending: false }
  const exhausted = new Map<number, Set<string>>()
  const eligible = [...options.eligible]
  const keyId = (credential: GeminiCredential) => `${credential.credentialId}:${credential.keyVersion}`

  const store: TranscriptionStore = {
    async claimJob() {
      state.jobStatus = 'running'
      return {
        attemptId: 'attempt-1',
        payload: { videoId: 'video-1', transcriptionId: 'tr-1', requestedByUserId: null, credentialOwnerUserId: null, channelId: CHANNEL },
      }
    },
    async loadContext() {
      return { ...context, parts: parts.map((part) => ({ ...part, exhaustedKeys: [...(exhausted.get(part.position) ?? [])] })) }
    },
    async loadCredential() {
      throw new Error('i job automatici non usano la chiave di un richiedente')
    },
    async acquireChannelCredential(): Promise<ChannelCredentialAcquisition> {
      return eligible[0] ? { status: 'assigned', credential: eligible[0] } : { status: 'waiting' }
    },
    async claimPartCredential(input): Promise<PartCredentialAcquisition> {
      const done = exhausted.get(input.partPosition) ?? new Set<string>()
      const next = eligible.find((candidate) => !done.has(keyId(candidate)))
      return next ? { status: 'assigned', credential: next } : { status: 'none' }
    },
    async recordPartKeyExhausted(input) {
      const set = exhausted.get(input.partPosition) ?? new Set<string>()
      set.add(keyId(input.credential))
      exhausted.set(input.partPosition, set)
      recorded.push({ owner: input.credential.ownerUserId, partPosition: input.partPosition, lastError: input.lastError })
      parts.find((part) => part.position === input.partPosition)!.attempts = 0
      return true
    },
    async savePart(input) {
      const part = parts.find((item) => item.position === input.partPosition)!
      part.status = input.status
      part.attempts = input.attempts
      part.lastError = input.lastError
      return true
    },
    async finalize(input) {
      if (input.closePending) {
        state.closedPending = true
        for (const part of parts) if (part.status === 'pending') part.status = 'missing'
      }
      if (parts.some((part) => part.status === 'pending')) return 'running'
      state.finalStatus = parts.some((part) => part.status === 'missing') ? 'needs_review' : 'complete'
      return state.finalStatus as 'complete' | 'needs_review'
    },
    async finishJob(input) {
      state.jobStatus = input.status
      state.jobError = input.errorMessage
      return true
    },
  }
  return { store, state, parts, recorded }
}

function ok() {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ language: 'it', segments: [{ start: '00:01', text: 'frase sintetica' }] }) }] } }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 },
  })
}

function run(store: TranscriptionStore, fetcher: ReturnType<typeof vi.fn>, extra: Partial<TranscriptionWorkerDeps> = {}) {
  return runTranscriptionJob('job-1', { store, fetcher: fetcher as unknown as typeof fetch, sleep: async () => undefined, concurrency: 1, ...extra })
}

const keyOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)['x-goog-api-key']

describe('job automatici con chiavi in rotazione', () => {
  beforeEach(() => {
    usageRows.length = 0
  })

  it('usa la chiave assegnata per tutto il job e attribuisce ogni tentativo al suo proprietario', async () => {
    const { store, state } = createAutoStore({ eligible: [key('anna'), key('bruno')] })
    const fetcher = vi.fn(async () => ok())

    const result = await run(store, fetcher)

    expect(result).toEqual({ outcome: 'complete', partsSaved: 3 })
    expect(fetcher.mock.calls.map(keyOf)).toEqual(['key-anna', 'key-anna', 'key-anna'])
    expect(usageRows).toHaveLength(3)
    expect(usageRows.every((row) => row.user_id === 'anna' && row.provider === 'gemini')).toBe(true)
    expect(state.jobStatus).toBe('completed')
  })

  it('ritenta sulla stessa chiave secondo il suo limite individuale', async () => {
    const { store, parts } = createAutoStore({ durationSeconds: 120, eligible: [key('anna', 2), key('bruno')] })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(ok())

    const result = await run(store, fetcher)

    expect(result.outcome).toBe('complete')
    expect(fetcher.mock.calls.map(keyOf)).toEqual(['key-anna', 'key-anna', 'key-anna'])
    expect(parts[0]).toMatchObject({ status: 'done', attempts: 3 })
    expect(usageRows.map((row) => [row.user_id, row.outcome])).toEqual([['anna', 'http_error'], ['anna', 'http_error'], ['anna', 'success']])
  })

  it('un 503 su una parte con limite 0 passa alla chiave successiva solo per quella parte', async () => {
    const { store, parts, recorded, state } = createAutoStore({ eligible: [key('anna'), key('bruno')] })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok()) // parte 0 con anna
      .mockResolvedValueOnce(new Response('x', { status: 503 })) // parte 1 con anna: esaurita solo per questa parte
      .mockImplementation(async () => ok()) // parte 1 con bruno, parte 2 di nuovo con la chiave del job

    const result = await run(store, fetcher)

    expect(result.outcome).toBe('complete')
    expect(fetcher.mock.calls.map(keyOf)).toEqual(['key-anna', 'key-anna', 'key-bruno', 'key-anna'])
    expect(recorded).toEqual([{ owner: 'anna', partPosition: 1, lastError: 'provider_http_503' }])
    expect(parts.map((part) => part.status)).toEqual(['done', 'done', 'done'])
    expect(usageRows.map((row) => row.user_id)).toEqual(['anna', 'anna', 'bruno', 'anna'])
    expect(state.closedPending).toBe(false)
  })

  it('con una sola chiave un 503 rende mancante soltanto la parte fallita, le altre restano done', async () => {
    const { store, parts, state } = createAutoStore({ eligible: [key('anna')] })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockImplementation(async () => ok())

    const result = await run(store, fetcher)

    expect(result.outcome).toBe('needs_review')
    expect(parts.map((part) => [part.status, part.lastError])).toEqual([['done', null], ['missing', 'provider_http_503'], ['done', null]])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(state.closedPending).toBe(false)
    expect(state.jobStatus).toBe('completed')
  })

  it('una parte non torna mai su una chiave già esaurita per lei e le altre parti proseguono', async () => {
    const { store, parts } = createAutoStore({ durationSeconds: 240, eligible: [key('anna'), key('bruno')] })
    // La parte 0 fallisce con entrambe le chiavi, la parte 1 riesce con la chiave del job.
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const start = JSON.parse(init!.body as string).contents[0].parts[0].videoMetadata.startOffset
      return start === '0s' ? new Response('x', { status: 429 }) : ok()
    })

    const result = await run(store, fetcher)

    expect(result.outcome).toBe('needs_review')
    expect(fetcher.mock.calls.map(keyOf)).toEqual(['key-anna', 'key-bruno', 'key-anna'])
    expect(parts.map((part) => part.status)).toEqual(['missing', 'done'])
  })

  it('riprende una parte già esaurita su una chiave senza ripetere i tentativi su quella chiave', async () => {
    const { store } = createAutoStore({ durationSeconds: 120, eligible: [key('anna'), key('bruno')] })
    await store.recordPartKeyExhausted({
      jobId: 'job-1', leaseId: 'lease', transcriptionId: 'tr-1', partPosition: 0, credential: key('anna'), lastError: 'provider_http_503',
    })
    const fetcher = vi.fn(async () => ok())

    const result = await run(store, fetcher)

    expect(result.outcome).toBe('complete')
    expect(fetcher.mock.calls.map(keyOf)).toEqual(['key-bruno'])
  })

  it('senza chiave eleggibile il job resta pending senza chiamare il provider', async () => {
    const { store, state, parts } = createAutoStore({ eligible: [] })
    const fetcher = vi.fn()

    const result = await run(store, fetcher)

    expect(result).toEqual({ outcome: 'waiting', partsSaved: 0 })
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.jobStatus).toBe('pending')
    expect(parts.every((part) => part.status === 'pending')).toBe(true)
    expect(usageRows).toHaveLength(0)
  })
})
