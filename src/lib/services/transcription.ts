/* Commento didattico:
 * Scopo del file: servizio di trascrizione Gemini a blocchi da 120 s (ADR-019), indipendente dal database.
 * Moduli richiamati: `node:crypto`, registratore uso API, helper dei tempi; la persistenza arriva dal `TranscriptionStore`.
 * Flusso: il worker reclama il job, chiama Gemini per ogni parte con la ricetta fissa, controlla i tempi senza scartare
 * testo, salva ogni parte subito e, se il budget di durata finisce, rilascia la lease per la continuazione.
 */

import { randomUUID } from 'node:crypto'
import { fetchAndRecordProviderRequest, type ProviderResponseUsage } from '@/lib/services/api-usage'
import { parseTranscriptTimestamp } from '@/lib/utils/transcript-time'

export const TRANSCRIPTION_JOB_TYPE = 'transcribe_video'
export const TRANSCRIPTION_CHUNK_SECONDS = 120
/** Frasi per parte: sotto lo stride di 10000 posizioni riservato a ogni parte nel database. */
export const TRANSCRIPTION_MAX_PHRASES_PER_PART = 2000
export const TRANSCRIPTION_MAX_PHRASE_CHARS = 4000
/** Tolleranza (secondi) oltre l'intervallo del blocco prima di marcare il tempo come dubbio. */
export const TRANSCRIPTION_BLOCK_TOLERANCE_SECONDS = 2
export const TRANSCRIPTION_CONCURRENCY = 4
export const TRANSCRIPTION_CALL_TIMEOUT_MS = 60_000
/** Dopo questo tempo dall'avvio non si iniziano nuovi blocchi (maxDuration route = 300 s). */
export const TRANSCRIPTION_SOFT_BUDGET_MS = 170_000
/** Dopo questo tempo non si inizia nessun nuovo tentativo: il blocco resta pending. */
export const TRANSCRIPTION_HARD_BUDGET_MS = 250_000
/** Lease oltre maxDuration: una lease scaduta implica un worker morto. */
export const TRANSCRIPTION_LEASE_MS = 330_000
export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const TRANSCRIPTION_USAGE_OPERATION = 'generateContent.transcribe'

export type TranscriptionStatus = 'pending' | 'running' | 'complete' | 'needs_review' | 'unavailable'
export type TranscriptionPartStatus = 'pending' | 'done' | 'missing'
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export interface TranscriptionProfile {
  model: string
  thinkingLevel: ThinkingLevel
  inputPricePerMillion: number
  outputPricePerMillion: number
}

export interface TranscriptionJobPayload {
  videoId: string
  transcriptionId: string
  requestedByUserId: string | null
  /** Proprietario della chiave Gemini da usare; per le richieste manuali coincide con chi richiede. */
  credentialOwnerUserId: string | null
  /** Canale del video per i job automatici: la chiave viene scelta in rotazione fra i follower del canale. */
  channelId: string | null
}

export interface TranscriptionPartState {
  position: number
  startSeconds: number
  endSeconds: number
  status: TranscriptionPartStatus
  attempts: number
  lastError: string | null
}

export interface TranscriptionContext {
  transcriptionId: string
  status: TranscriptionStatus
  youtubeVideoId: string
  model: string
  thinkingLevel: ThinkingLevel
  inputPricePerMillion: number
  outputPricePerMillion: number
  parts: TranscriptionPartState[]
}

export interface GeminiCredential {
  ownerUserId: string
  apiKey: string
  /** Tentativi totali per blocco = 1 + retryLimit (limite individuale della chiave). */
  retryLimit: number
  /** Presenti solo per le chiavi assegnate in rotazione ai job automatici. */
  credentialId?: string
  keyVersion?: string
}

/** Esito della richiesta di una chiave in rotazione per un job automatico. */
export type ChannelCredentialAcquisition =
  | { status: 'assigned'; credential: GeminiCredential }
  | { status: 'waiting' }
  | { status: 'exhausted' }
  | { status: 'lease_lost' }

export interface PhraseToSave {
  idx: number
  start_seconds: number
  text: string
  doubtful_time: boolean
}

export interface SavePartInput {
  jobId: string
  leaseId: string
  transcriptionId: string
  partPosition: number
  status: TranscriptionPartStatus
  attempts: number
  lastError: string | null
  languageCode: string | null
  phrases: PhraseToSave[] | null
}

/** Confine di persistenza del worker: implementato su Supabase e sostituibile nei test. */
export interface TranscriptionStore {
  claimJob(input: { jobId: string; leaseId: string; startedAt: string; leaseExpiresAt: string }):
    Promise<{ attemptId: string; payload: TranscriptionJobPayload } | null>
  loadContext(payload: TranscriptionJobPayload): Promise<TranscriptionContext | null>
  loadCredential(ownerUserId: string | null): Promise<GeminiCredential | null>
  /** Job automatici: chiave del job (stessa per i retry) o la successiva eleggibile in round-robin per canale. */
  acquireChannelCredential(input: { jobId: string; leaseId: string; channelId: string }): Promise<ChannelCredentialAcquisition>
  /** Rilascia la chiave del job (esaurita o non utilizzabile) e azzera i tentativi delle parti pending. False se lease persa. */
  releaseChannelCredential(input: {
    jobId: string
    leaseId: string
    credential: GeminiCredential
    status: 'exhausted' | 'ineligible'
    transcriptionId: string
    partPosition: number | null
    lastError: string | null
  }): Promise<boolean>
  /** False se la lease è stata persa (nessuna scrittura avvenuta). */
  savePart(input: SavePartInput): Promise<boolean>
  /** Restituisce lo stato calcolato dal database, o null se la lease è persa. */
  finalize(input: { jobId: string; leaseId: string; transcriptionId: string; closePending: boolean }):
    Promise<TranscriptionStatus | null>
  finishJob(input: {
    jobId: string
    leaseId: string
    attemptId: string
    status: 'pending' | 'completed' | 'failed'
    completedAt: string
    errorMessage: string | null
    errorDetails: Record<string, unknown> | null
  }): Promise<boolean>
}

export interface TranscriptionWorkerDeps {
  store: TranscriptionStore
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  concurrency?: number
  callTimeoutMs?: number
  softBudgetMs?: number
  hardBudgetMs?: number
  leaseMs?: number
  /** Chiede la continuazione di un job rilasciato; errori ignorati (c'è il recupero del daily-sync). */
  requestContinuation?: (jobId: string) => Promise<void>
}

export type TranscriptionRunOutcome =
  | 'not_claimed'
  | 'reused'
  | 'complete'
  | 'needs_review'
  | 'yielded'
  | 'lease_lost'
  | 'waiting'
  | 'failed'

export interface TranscriptionRunResult {
  outcome: TranscriptionRunOutcome
  /** Parti salvate (done o missing) da questa esecuzione. */
  partsSaved: number
}

const THINKING_BUDGETS: Record<ThinkingLevel, number> = { minimal: 0, low: 1024, medium: 8192, high: 24576 }

const PROMPT = "Trascrivi parola per parola il parlato di questo video, nella lingua originale, senza riassumere "
  + "né omettere frasi. Dividi in segmenti brevi (una frase o al massimo circa 5 secondi). Per ogni segmento "
  + "indica 'start' = momento in cui inizia la prima parola, nel formato MM:SS riferito all'inizio del video "
  + "completo, e 'text' = testo esatto. Indica inoltre in 'language' il codice ISO 639-1 della lingua originale parlata."

/** Configurazione di thinking: budget per la serie 2.5, livello per le altre. */
export function buildThinkingConfig(model: string, level: ThinkingLevel): Record<string, unknown> {
  return model.startsWith('gemini-2.5')
    ? { thinkingBudget: THINKING_BUDGETS[level] }
    : { thinkingLevel: level }
}

/** Corpo della richiesta generateContent con la ricetta fissa (URL YouTube, offset, JSON, bassa risoluzione). */
export function buildTranscriptionRequestBody(input: {
  model: string
  thinkingLevel: ThinkingLevel
  youtubeVideoId: string
  startSeconds: number
  endSeconds: number
}): Record<string, unknown> {
  return {
    contents: [{
      parts: [
        {
          fileData: { fileUri: `https://www.youtube.com/watch?v=${input.youtubeVideoId}` },
          videoMetadata: { startOffset: `${input.startSeconds}s`, endOffset: `${input.endSeconds}s` },
        },
        { text: `${PROMPT} Questo spezzone va dal secondo ${input.startSeconds} al secondo ${input.endSeconds} del video.` },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          language: { type: 'STRING' },
          segments: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { start: { type: 'STRING' }, text: { type: 'STRING' } },
              required: ['start', 'text'],
            },
          },
        },
        required: ['language', 'segments'],
      },
      temperature: 0,
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
      thinkingConfig: buildThinkingConfig(input.model, input.thinkingLevel),
    },
  }
}

/** Normalizza il codice lingua nel formato accettato dal database (`it`, `pt-BR`) o null. */
export function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\s*([A-Za-z]{2,3})(?:[-_]([A-Za-z0-9]{2,8}))?\s*$/.exec(value)
  if (!match) return null
  return match[2] ? `${match[1].toLowerCase()}-${match[2]}` : match[1].toLowerCase()
}

interface RawSegment { start: unknown; text: string }

/** Estrae lingua e segmenti dalla risposta Gemini; null se il JSON è illeggibile. */
export function parseTranscriptionResponse(body: unknown): { languageCode: string | null; segments: RawSegment[] } | null {
  const candidates = (body as { candidates?: unknown } | null)?.candidates
  const parts = Array.isArray(candidates)
    ? (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts
    : undefined
  if (!Array.isArray(parts)) return null
  const text = parts
    .map((part) => {
      const typed = part as { text?: unknown; thought?: unknown }
      return typed && typeof typed.text === 'string' && typed.thought !== true ? typed.text : ''
    })
    .join('')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const rawSegments = Array.isArray(parsed) ? parsed : (parsed as { segments?: unknown } | null)?.segments
  if (!Array.isArray(rawSegments)) return null
  const segments: RawSegment[] = []
  for (const item of rawSegments) {
    const typed = item as { start?: unknown; text?: unknown } | null
    if (typed && typeof typed.text === 'string') segments.push({ start: typed.start, text: typed.text })
  }
  const language = Array.isArray(parsed) ? null : (parsed as { language?: unknown } | null)?.language
  return { languageCode: normalizeLanguageCode(language), segments }
}

/**
 * Controlla i tempi di un blocco senza scartare testo: un tempo fuori da [inizio-2, fine+2], non leggibile o minore
 * dell'ultimo tempo valido produce una frase conservata con `doubtful_time`.
 */
export function checkBlockPhrases(
  segments: RawSegment[],
  block: { startSeconds: number; endSeconds: number }
): PhraseToSave[] {
  const phrases: PhraseToSave[] = []
  let lastValidStart: number | null = null
  for (const segment of segments) {
    const text = segment.text.trim().slice(0, TRANSCRIPTION_MAX_PHRASE_CHARS)
    if (!text) continue
    if (phrases.length >= TRANSCRIPTION_MAX_PHRASES_PER_PART) break
    const parsed = parseTranscriptTimestamp(segment.start)
    let doubtful = false
    let start: number
    if (parsed === null) {
      doubtful = true
      start = lastValidStart ?? block.startSeconds
    } else {
      start = parsed
      const outOfBlock = start < block.startSeconds - TRANSCRIPTION_BLOCK_TOLERANCE_SECONDS
        || start > block.endSeconds + TRANSCRIPTION_BLOCK_TOLERANCE_SECONDS
      const backwards = lastValidStart !== null && start < lastValidStart
      doubtful = outOfBlock || backwards
      if (!doubtful) lastValidStart = start
    }
    phrases.push({ idx: phrases.length, start_seconds: start, text, doubtful_time: doubtful })
  }
  return phrases
}

/** Legge i token dalla risposta Gemini (`usageMetadata`) per il registro uso. */
async function readGeminiUsage(response: Response): Promise<ProviderResponseUsage | null> {
  const body = await response.json() as {
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown }
  }
  const usage = body.usageMetadata
  if (!usage) return null
  const asCount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null)
  return {
    inputTokens: asCount(usage.promptTokenCount),
    outputTokens: asCount(usage.candidatesTokenCount),
    totalTokens: asCount(usage.totalTokenCount),
  }
}

type BlockAttemptResult =
  | { ok: true; phrases: PhraseToSave[]; languageCode: string | null }
  | { ok: false; error: string }

/** Un singolo tentativo su un blocco: sempre registrato nel registro uso del proprietario della chiave. */
async function attemptBlock(input: {
  credential: GeminiCredential
  context: TranscriptionContext
  part: TranscriptionPartState
  fetcher: typeof fetch
  timeoutMs: number
}): Promise<BlockAttemptResult> {
  const { credential, context, part } = input
  let response: Response
  try {
    response = await fetchAndRecordProviderRequest({
      userId: credential.ownerUserId,
      provider: 'gemini',
      operation: TRANSCRIPTION_USAGE_OPERATION,
      model: context.model,
      inputRateUsdPerMillion: context.inputPricePerMillion,
      outputRateUsdPerMillion: context.outputPricePerMillion,
      url: `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(context.model)}:generateContent`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': credential.apiKey },
        body: JSON.stringify(buildTranscriptionRequestBody({
          model: context.model,
          thinkingLevel: context.thinkingLevel,
          youtubeVideoId: context.youtubeVideoId,
          startSeconds: part.startSeconds,
          endSeconds: part.endSeconds,
        })),
        cache: 'no-store',
        signal: AbortSignal.timeout(input.timeoutMs),
      },
      fetcher: input.fetcher,
      readUsage: readGeminiUsage,
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return { ok: false, error: timedOut ? 'timeout' : 'network_error' }
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return { ok: false, error: `provider_http_${response.status}` }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return { ok: false, error: timedOut ? 'timeout' : 'unreadable_response' }
  }
  const parsed = parseTranscriptionResponse(body)
  if (!parsed) return { ok: false, error: 'unreadable_response' }
  return {
    ok: true,
    phrases: checkBlockPhrases(parsed.segments, part),
    languageCode: parsed.languageCode,
  }
}

/** Divide la durata in parti da 120 s (l'ultima può essere più corta). */
export function buildTranscriptionParts(durationSeconds: number, chunkSeconds = TRANSCRIPTION_CHUNK_SECONDS): Array<{
  position: number
  startSeconds: number
  endSeconds: number
}> {
  const parts: Array<{ position: number; startSeconds: number; endSeconds: number }> = []
  for (let start = 0, position = 0; start < durationSeconds; start += chunkSeconds, position += 1) {
    parts.push({ position, startSeconds: start, endSeconds: Math.min(start + chunkSeconds, durationSeconds) })
  }
  return parts
}

/** Legge e valida il payload del job; null se manca un campo obbligatorio. */
export function parseTranscriptionJobPayload(value: unknown): TranscriptionJobPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.videoId !== 'string' || typeof raw.transcriptionId !== 'string') return null
  return {
    videoId: raw.videoId,
    transcriptionId: raw.transcriptionId,
    requestedByUserId: typeof raw.requestedByUserId === 'string' ? raw.requestedByUserId : null,
    credentialOwnerUserId: typeof raw.credentialOwnerUserId === 'string' ? raw.credentialOwnerUserId : null,
    channelId: typeof raw.channelId === 'string' ? raw.channelId : null,
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Esegue (o riprende) un job di trascrizione. Salva ogni parte appena pronta, quindi un'interruzione riprende dai
 * blocchi mancanti. Se il budget di durata finisce prima di aver coperto tutte le parti, rilascia la lease (`pending`)
 * e chiede la continuazione.
 */
export async function runTranscriptionJob(jobId: string, deps: TranscriptionWorkerDeps): Promise<TranscriptionRunResult> {
  const { store } = deps
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  const fetcher = deps.fetcher ?? fetch
  const concurrency = deps.concurrency ?? TRANSCRIPTION_CONCURRENCY
  const callTimeoutMs = deps.callTimeoutMs ?? TRANSCRIPTION_CALL_TIMEOUT_MS
  const softBudgetMs = deps.softBudgetMs ?? TRANSCRIPTION_SOFT_BUDGET_MS
  const hardBudgetMs = deps.hardBudgetMs ?? TRANSCRIPTION_HARD_BUDGET_MS
  const leaseMs = deps.leaseMs ?? TRANSCRIPTION_LEASE_MS
  const startedMs = now()
  const leaseId = randomUUID()

  const claim = await store.claimJob({
    jobId,
    leaseId,
    startedAt: new Date(startedMs).toISOString(),
    leaseExpiresAt: new Date(startedMs + leaseMs).toISOString(),
  })
  if (!claim) return { outcome: 'not_claimed', partsSaved: 0 }

  const finish = (status: 'pending' | 'completed' | 'failed', errorMessage: string | null, details: Record<string, unknown> | null) =>
    store.finishJob({
      jobId, leaseId, attemptId: claim.attemptId, status,
      completedAt: new Date(now()).toISOString(), errorMessage, errorDetails: details,
    })

  let partsSaved = 0
  try {
    const context = await store.loadContext(claim.payload)
    if (!context) {
      await finish('failed', 'transcription_not_found', null)
      return { outcome: 'failed', partsSaved }
    }
    // Riuso canonico: nessuna chiamata se la trascrizione è già disponibile.
    if (context.status === 'complete' || context.status === 'needs_review') {
      await finish('completed', null, { reused: true })
      return { outcome: 'reused', partsSaved }
    }

    // Job automatico: chiave in rotazione fra i follower del canale; richiesta manuale: chiave di chi richiede.
    const rotatingChannelId = claim.payload.credentialOwnerUserId === null ? claim.payload.channelId : null
    let activeContext: TranscriptionContext = context
    let pending = context.parts.filter((part) => part.status === 'pending')
    while (pending.length > 0) {
      let credential: GeminiCredential | null
      if (rotatingChannelId) {
        const acquired = await store.acquireChannelCredential({ jobId, leaseId, channelId: rotatingChannelId })
        if (acquired.status === 'lease_lost') return { outcome: 'lease_lost', partsSaved }
        if (acquired.status === 'waiting') {
          // Nessuna chiave eleggibile: il job attende senza usare chiavi estranee al canale (ADR-018).
          const released = await finish('pending', null, { waiting: true })
          return { outcome: released ? 'waiting' : 'lease_lost', partsSaved }
        }
        if (acquired.status === 'exhausted') {
          // Tutte le chiavi eleggibili hanno esaurito i tentativi: le parti restanti diventano mancanti.
          const exhaustedStatus = await store.finalize({
            jobId, leaseId, transcriptionId: activeContext.transcriptionId, closePending: true,
          })
          if (exhaustedStatus === null) return { outcome: 'lease_lost', partsSaved }
          await finish('completed', null, { status: exhaustedStatus, keysExhausted: true })
          return { outcome: 'needs_review', partsSaved }
        }
        credential = acquired.credential
      } else {
        credential = await store.loadCredential(claim.payload.credentialOwnerUserId)
      }
      if (!credential) {
        // Senza chiave utilizzabile le parti restano rilanciabili come mancanti.
        await store.finalize({ jobId, leaseId, transcriptionId: activeContext.transcriptionId, closePending: true })
        await finish('failed', 'credential_unavailable', null)
        return { outcome: 'failed', partsSaved }
      }
      const activeCredential = credential
      const partsToRun = pending
      const ctx = activeContext

      let nextIndex = 0
      let leaseLost = false
      let keyReleased = false
      let fatal: unknown = null
      let unfinished = partsToRun.length

      const processPart = async (part: TranscriptionPartState): Promise<'saved' | 'deferred' | 'lease_lost'> => {
        const maxAttempts = 1 + activeCredential.retryLimit
        let attempts = part.attempts
        let lastError = part.lastError
        while (attempts < maxAttempts) {
          if (keyReleased) return 'deferred'
          if (now() - startedMs + callTimeoutMs > hardBudgetMs) {
            if (attempts > part.attempts) {
              const persisted = await store.savePart({
                jobId, leaseId, transcriptionId: ctx.transcriptionId, partPosition: part.position,
                status: 'pending', attempts, lastError, languageCode: null, phrases: null,
              })
              if (!persisted) return 'lease_lost'
            }
            return 'deferred'
          }
          attempts += 1
          const result = await attemptBlock({ credential: activeCredential, context: ctx, part, fetcher, timeoutMs: callTimeoutMs })
          if (result.ok) {
            const saved = await store.savePart({
              jobId, leaseId, transcriptionId: ctx.transcriptionId, partPosition: part.position,
              status: 'done', attempts, lastError: null, languageCode: result.languageCode, phrases: result.phrases,
            })
            return saved ? 'saved' : 'lease_lost'
          }
          lastError = result.error
          // Un'altra corsia ha già rilasciato questa chiave: il tentativo fallito non va salvato (i contatori sono stati azzerati).
          if (keyReleased) return 'deferred'
          if (attempts < maxAttempts) await sleep(Math.min(500 * 2 ** (attempts - 1), 8_000))
        }
        if (rotatingChannelId) {
          // Chiave esaurita su questa parte: passa alla successiva eleggibile per le parti ancora pending.
          if (keyReleased) return 'deferred'
          keyReleased = true
          const released = await store.releaseChannelCredential({
            jobId, leaseId, credential: activeCredential, status: 'exhausted',
            transcriptionId: ctx.transcriptionId, partPosition: part.position, lastError: lastError ?? 'retry_budget_exhausted',
          })
          return released ? 'deferred' : 'lease_lost'
        }
        const saved = await store.savePart({
          jobId, leaseId, transcriptionId: ctx.transcriptionId, partPosition: part.position,
          status: 'missing', attempts, lastError: lastError ?? 'retry_budget_exhausted', languageCode: null, phrases: null,
        })
        return saved ? 'saved' : 'lease_lost'
      }

      const runLane = async () => {
        while (!leaseLost && !keyReleased && fatal === null) {
          if (now() - startedMs >= softBudgetMs) return
          const index = nextIndex
          nextIndex += 1
          if (index >= partsToRun.length) return
          try {
            const outcome = await processPart(partsToRun[index])
            if (outcome === 'saved') { partsSaved += 1; unfinished -= 1 }
            else if (outcome === 'lease_lost') leaseLost = true
            else return
          } catch (error) {
            fatal = error
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, partsToRun.length) }, runLane))

      if (leaseLost) return { outcome: 'lease_lost', partsSaved }
      if (fatal !== null) throw fatal
      if (keyReleased) {
        // Ricarica lo stato salvato e riparte con la chiave successiva (o chiude se non ce ne sono).
        const reloaded = await store.loadContext(claim.payload)
        if (!reloaded) {
          await finish('failed', 'transcription_not_found', null)
          return { outcome: 'failed', partsSaved }
        }
        activeContext = reloaded
        pending = reloaded.parts.filter((part) => part.status === 'pending')
        continue
      }
      if (unfinished > 0) {
        const released = await finish('pending', null, { yielded: true, remainingParts: unfinished })
        if (!released) return { outcome: 'lease_lost', partsSaved }
        if (deps.requestContinuation) await deps.requestContinuation(jobId).catch(() => undefined)
        return { outcome: 'yielded', partsSaved }
      }
      break
    }

    const finalStatus = await store.finalize({
      jobId, leaseId, transcriptionId: activeContext.transcriptionId, closePending: false,
    })
    if (finalStatus === null) return { outcome: 'lease_lost', partsSaved }
    await finish('completed', null, { status: finalStatus })
    return { outcome: finalStatus === 'complete' ? 'complete' : 'needs_review', partsSaved }
  } catch {
    // Dettagli interni (query, chiavi, risposte) non vengono mai loggati: solo il codice stabile.
    console.error('Transcription job failed: worker_error')
    await finish('failed', 'worker_error', null).catch(() => false)
    return { outcome: 'failed', partsSaved }
  }
}
