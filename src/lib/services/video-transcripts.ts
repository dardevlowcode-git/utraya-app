/* Commento didattico:
 * Scopo del file: fetch e cache delle trascrizioni YouTube solo per i NUOVI video (una lingua principale).
 * Moduli richiamati: `@/lib/supabase/admin` per client service_role (bypass RLS, mai esposto al browser).
 * Flusso: youtubei player ANDROID -> scelta 1 captionTrack -> timedtext fmt=json3 -> upsert su video_transcripts.
 */

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  classifyDiagnosticError,
  extractPlayerDiagnosticFields,
  persistTranscriptDiagnostics,
  sanitizeDiagnosticText,
  type TranscriptAttemptDiagnostic,
  type TranscriptDiagnosticClient,
  type TranscriptDiagnosticOutcome,
  type TranscriptDiagnosticStage,
} from '@/lib/services/transcript-diagnostics'

type AdminClient = ReturnType<typeof createAdminClient>
type FetchImpl = typeof fetch

export interface CaptionTrack {
  baseUrl: string
  languageCode: string
  kind?: string
  vssId?: string
}

export interface MainTranscript {
  language_code: string
  kind: 'standard' | 'asr'
  is_asr: boolean
  text: string
  segments: Array<{ start: number; end: number; text: string }> | null
}

export type TranscriptOutcome = 'fetched' | 'missing' | 'failed' | 'skipped'

interface TranscriptDiagnosticContext {
  fetchRunId: string
  videoId: string
  requestId: string | null
}

class TranscriptFetchError extends Error {
  constructor(message: string, readonly diagnosticAttempts: TranscriptAttemptDiagnostic[]) {
    super(message)
    this.name = 'TranscriptFetchError'
  }
}

const FETCH_TIMEOUT_MS = 8000
const ERROR_DETAILS_MAX_LENGTH = 500
const PENDING_LANGUAGE = 'unknown'

// Chiave letta da YOUTUBEI_API_KEY (Vercel env, mai in git).
function getYoutubeiKey(): string {
  const key = process.env.YOUTUBEI_API_KEY?.trim()
  if (!key) throw new Error('YOUTUBEI_API_KEY mancante: impostarla in Vercel env')
  return key
}

function isAsrTrack(track: CaptionTrack): boolean {
  return track.kind === 'asr' || (track.vssId ?? '').startsWith('a.')
}

function buildTimedtextUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const isYouTubeHost = url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')
  if (url.protocol !== 'https:' || !isYouTubeHost) {
    throw new Error('caption track URL non autorizzato')
  }
  url.searchParams.set('fmt', 'json3')
  return url.toString()
}

/**
 * Sceglie UNA sola traccia in lingua principale:
 * manuale standard > ASR > en di ripiego. Mai traduzioni (nessun parametro tlang).
 */
export function pickMainTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const usable = tracks.filter((track) => Boolean(track.baseUrl) && Boolean(track.languageCode))
  if (usable.length === 0) return null

  const manual = usable.find((track) => !isAsrTrack(track))
  if (manual) return manual

  const asr = usable.find((track) => isAsrTrack(track))
  if (asr) return asr

  return usable.find((track) => track.languageCode.toLowerCase().startsWith('en')) ?? null
}

interface Json3Event {
  tStartMs?: number
  dDurationMs?: number
  segs?: Array<{ utf8?: string }>
}

function parseJson3(payload: { events?: Json3Event[] }): { text: string; segments: MainTranscript['segments'] } {
  const segments: Array<{ start: number; end: number; text: string }> = []

  for (const event of payload.events ?? []) {
    const text = (event.segs ?? []).map((seg) => seg.utf8 ?? '').join('').trim()
    if (!text) continue
    const start = (event.tStartMs ?? 0) / 1000
    const end = start + ((event.dDurationMs ?? 0) / 1000)
    segments.push({ start, end, text })
  }

  const text = segments.map((segment) => segment.text).join('\n').trim()
  return { text, segments: segments.length > 0 ? segments : null }
}

/**
 * Scarica la trascrizione principale provando i client youtubei in ordine
 * (ANDROID poi TVHTML5: gli IP datacenter Vercel spesso ricevono risposte
 * player SENZA tracce, il secondo client funge da fallback).
 * Ritorna `{ transcript, diagnostics }`: transcript null se nessun client
 * dà tracce (da marcare `missing` con diagnostics come error_details),
 * lancia eccezione se nessun player risponde o su errori timedtext
 * (da marcare `failed`).
 */
export async function fetchMainTranscript(
  youtubeVideoId: string,
  fetchImpl: FetchImpl = fetch,
  context: TranscriptDiagnosticContext = {
    fetchRunId: randomUUID(),
    videoId: '00000000-0000-4000-8000-000000000000',
    requestId: null,
  }
): Promise<{
  transcript: MainTranscript | null
  diagnostics: string
  diagnosticAttempts: TranscriptAttemptDiagnostic[]
}> {
  const clients = [
    { clientName: 'ANDROID', clientVersion: '20.10.38' },
    { clientName: 'TVHTML5', clientVersion: '7.20240101' },
  ] as const
  const clientHeaders: Record<(typeof clients)[number]['clientName'], Record<string, string>> = {
    ANDROID: {
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14; it_IT; Pixel 7 Build/UQ1A.240105.004)',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
      Accept: '*/*',
    },
    TVHTML5: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
      Accept: '*/*',
    },
  }
  const attempts: string[] = []
  const diagnosticAttempts: TranscriptAttemptDiagnostic[] = []
  let playerSucceeded = false
  let currentAttemptStartedAt = Date.now()

  const makeDiagnostic = (
    attemptNo: number,
    clientName: TranscriptDiagnosticClient | null,
    stage: TranscriptDiagnosticStage,
    outcome: TranscriptDiagnosticOutcome
  ): TranscriptAttemptDiagnostic => ({
    fetch_run_id: context.fetchRunId,
    video_id: context.videoId,
    request_id: context.requestId,
    attempt_no: attemptNo,
    client_name: clientName,
    stage,
    outcome,
    player_http_status: null,
    player_status_text: null,
    player_content_type: null,
    playability_status: null,
    player_reason: null,
    player_subreason: null,
    player_error_code: null,
    player_error_message: null,
    track_count: null,
    usable_track_count: null,
    selected_track_language: null,
    selected_track_kind: null,
    timedtext_http_status: null,
    timedtext_status_text: null,
    timedtext_content_type: null,
    player_duration_ms: null,
    timedtext_duration_ms: null,
    error_type: null,
    error_code: null,
    error_message: null,
    attempt_started_at: new Date(currentAttemptStartedAt).toISOString(),
    completed_at: new Date().toISOString(),
  })

  let apiKey: string
  try {
    apiKey = getYoutubeiKey()
  } catch {
    diagnosticAttempts.push({
      ...makeDiagnostic(0, null, 'configuration', 'configuration_error'),
      error_type: 'ConfigurationError',
      error_code: 'YOUTUBEI_API_KEY_MISSING',
      error_message: 'YOUTUBEI_API_KEY mancante',
    })
    throw new TranscriptFetchError('YOUTUBEI_API_KEY mancante', diagnosticAttempts)
  }

  for (const [index, client] of clients.entries()) {
    const attemptNo = index + 1
    const playerStartedAt = Date.now()
    currentAttemptStartedAt = playerStartedAt
    let playerResponse: Response
    try {
      playerResponse = await fetchImpl(
        `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
        {
          method: 'POST',
          headers: clientHeaders[client.clientName],
          body: JSON.stringify({
            videoId: youtubeVideoId,
            context: { client: { clientName: client.clientName, clientVersion: client.clientVersion } },
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }
      )
    } catch (error) {
      const errorInfo = classifyDiagnosticError(error)
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'player', errorInfo.outcome),
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: errorInfo.error_type,
        error_code: errorInfo.error_code,
        error_message: errorInfo.error_message,
      })
      attempts.push(`${client.clientName}(err:${errorInfo.outcome})`)
      continue
    }

    if (!playerResponse.ok) {
      const responsePayload = playerResponse.headers.get('content-type')?.toLowerCase().includes('json')
        ? await playerResponse.json().catch(() => null)
        : null
      const fields = extractPlayerDiagnosticFields(responsePayload)
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'player', 'http_error'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: 'HttpError',
        error_code: fields.player_error_code ?? `HTTP_${playerResponse.status}`,
        error_message: fields.player_error_message,
      })
      attempts.push(`${client.clientName}(http:${playerResponse.status})`)
      continue
    }

    let parsedPlayer: unknown
    try {
      parsedPlayer = await playerResponse.json()
    } catch (error) {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'player', 'invalid_json'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: error instanceof Error ? sanitizeDiagnosticText(error.name, 100) : 'InvalidJson',
        error_code: 'PLAYER_INVALID_JSON',
        error_message: 'Risposta player non JSON o malformata',
      })
      attempts.push(`${client.clientName}(json:invalid)`)
      continue
    }

    if (parsedPlayer === null || typeof parsedPlayer !== 'object' || Array.isArray(parsedPlayer)) {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'player', 'invalid_json'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: 'InvalidPlayerShape',
        error_code: 'PLAYER_INVALID_SHAPE',
        error_message: 'La risposta player non è un oggetto JSON',
      })
      throw new TranscriptFetchError('player payload non valido', diagnosticAttempts)
    }

    let playerJson: {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } }
      playabilityStatus?: {
        status?: string
        reason?: unknown
        subreason?: unknown
        errorScreen?: unknown
      }
      error?: unknown
    }
    playerJson = parsedPlayer as typeof playerJson
    playerSucceeded = true

    const rawTracks = playerJson.captions?.playerCaptionsTracklistRenderer?.captionTracks
    const trackCount = rawTracks == null ? 0 : Array.isArray(rawTracks) ? rawTracks.length : null
    const tracks = Array.isArray(rawTracks) ? rawTracks as CaptionTrack[] : []
    const usableTrackCount = Array.isArray(rawTracks)
      ? rawTracks.filter((candidate) => {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false
        const trackRecord = candidate as Record<string, unknown>
        return Boolean(trackRecord.baseUrl) && Boolean(trackRecord.languageCode)
      }).length
      : 0
    const play = playerJson.playabilityStatus?.status ?? '?'
    const fields = extractPlayerDiagnosticFields(playerJson)

    if (rawTracks !== null && rawTracks !== undefined && !Array.isArray(rawTracks)) {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'player', 'invalid_json'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: null,
        usable_track_count: 0,
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: 'InvalidPlayerShape',
        error_code: 'CAPTION_TRACKS_INVALID_SHAPE',
        error_message: 'captionTracks non è un array',
      })
      attempts.push(`${client.clientName}(tracks:invalid)`)
      throw new TranscriptFetchError('captionTracks non valido', diagnosticAttempts)
    }

    let track: CaptionTrack | null
    try {
      track = pickMainTrack(tracks)
    } catch {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'player', 'invalid_json'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: 'InvalidPlayerTrack',
        error_code: 'CAPTION_TRACK_INVALID_SHAPE',
        error_message: 'Una caption track ha forma non valida',
      })
      throw new TranscriptFetchError('caption track non valida', diagnosticAttempts)
    }
    if (!track) {
      const hasExplicitPlayabilityFailure = Boolean(fields.playability_status && fields.playability_status !== 'OK')
      const outcome = hasExplicitPlayabilityFailure ? 'playability_blocked' : 'no_usable_track'
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'player', outcome),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: hasExplicitPlayabilityFailure ? 'PlayabilityStatus' : 'NoUsableTrack',
        error_code: fields.player_error_code ?? (hasExplicitPlayabilityFailure ? sanitizeDiagnosticText(play, 100) : 'NO_USABLE_TRACK'),
        error_message: fields.player_error_message ?? fields.player_reason,
      })
      attempts.push(`${client.clientName}(tracce:${trackCount ?? '?'},play:${play})`)
      continue
    }

    // Mai `tlang`: solo la lingua originale della traccia scelta.
    let timedtextUrl: string
    try {
      timedtextUrl = buildTimedtextUrl(track.baseUrl)
    } catch {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'timedtext', 'timedtext_error'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        selected_track_language: sanitizeDiagnosticText(track.languageCode, 64),
        selected_track_kind: sanitizeDiagnosticText(track.kind ?? (isAsrTrack(track) ? 'asr' : 'standard'), 32),
        player_duration_ms: Date.now() - playerStartedAt,
        error_type: 'InvalidCaptionUrl',
        error_code: 'CAPTION_URL_REJECTED',
        error_message: 'Caption URL non autorizzato',
      })
      throw new TranscriptFetchError('caption track URL non autorizzato', diagnosticAttempts)
    }
    // GET timedtext: stessi header realistici della POST, senza Content-Type (GET senza body).
    const timedtextHeaders = { ...clientHeaders[client.clientName] }
    delete timedtextHeaders['Content-Type']
    const timedtextStartedAt = Date.now()
    let timedtextResponse: Response
    try {
      timedtextResponse = await fetchImpl(timedtextUrl, {
        headers: timedtextHeaders,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch (error) {
      const errorInfo = classifyDiagnosticError(error)
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'timedtext', errorInfo.outcome),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        selected_track_language: sanitizeDiagnosticText(track.languageCode, 64),
        selected_track_kind: sanitizeDiagnosticText(track.kind ?? (isAsrTrack(track) ? 'asr' : 'standard'), 32),
        player_duration_ms: Date.now() - playerStartedAt,
        timedtext_duration_ms: Date.now() - timedtextStartedAt,
        error_type: errorInfo.error_type,
        error_code: errorInfo.error_code,
        error_message: errorInfo.error_message,
      })
      throw new TranscriptFetchError('timedtext fetch fallito', diagnosticAttempts)
    }

    if (!timedtextResponse.ok) {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'timedtext', 'timedtext_error'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        selected_track_language: sanitizeDiagnosticText(track.languageCode, 64),
        selected_track_kind: sanitizeDiagnosticText(track.kind ?? (isAsrTrack(track) ? 'asr' : 'standard'), 32),
        player_duration_ms: Date.now() - playerStartedAt,
        timedtext_http_status: timedtextResponse.status,
        timedtext_status_text: sanitizeDiagnosticText(timedtextResponse.statusText, 256),
        timedtext_content_type: sanitizeDiagnosticText(timedtextResponse.headers.get('content-type'), 128),
        timedtext_duration_ms: Date.now() - timedtextStartedAt,
        error_type: 'HttpError',
        error_code: `HTTP_${timedtextResponse.status}`,
        error_message: `timedtext status ${timedtextResponse.status}`,
      })
      throw new TranscriptFetchError(`timedtext status ${timedtextResponse.status}`, diagnosticAttempts)
    }

    let timedtextJson: { events?: Json3Event[] }
    try {
      timedtextJson = (await timedtextResponse.json()) as { events?: Json3Event[] }
    } catch {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'timedtext', 'invalid_json'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        selected_track_language: sanitizeDiagnosticText(track.languageCode, 64),
        selected_track_kind: sanitizeDiagnosticText(track.kind ?? (isAsrTrack(track) ? 'asr' : 'standard'), 32),
        player_duration_ms: Date.now() - playerStartedAt,
        timedtext_http_status: timedtextResponse.status,
        timedtext_status_text: sanitizeDiagnosticText(timedtextResponse.statusText, 256),
        timedtext_content_type: sanitizeDiagnosticText(timedtextResponse.headers.get('content-type'), 128),
        timedtext_duration_ms: Date.now() - timedtextStartedAt,
        error_type: 'InvalidJson',
        error_code: 'TIMEDTEXT_INVALID_JSON',
        error_message: 'Risposta timedtext non JSON o malformata',
      })
      throw new TranscriptFetchError('timedtext risposta non valida', diagnosticAttempts)
    }

    let parsedTimedtext: { text: string; segments: MainTranscript['segments'] }
    try {
      parsedTimedtext = parseJson3(timedtextJson)
    } catch {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'timedtext', 'invalid_json'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        selected_track_language: sanitizeDiagnosticText(track.languageCode, 64),
        selected_track_kind: sanitizeDiagnosticText(track.kind ?? (isAsrTrack(track) ? 'asr' : 'standard'), 32),
        player_duration_ms: Date.now() - playerStartedAt,
        timedtext_http_status: timedtextResponse.status,
        timedtext_status_text: sanitizeDiagnosticText(timedtextResponse.statusText, 256),
        timedtext_content_type: sanitizeDiagnosticText(timedtextResponse.headers.get('content-type'), 128),
        timedtext_duration_ms: Date.now() - timedtextStartedAt,
        error_type: 'InvalidTimedtextShape',
        error_code: 'TIMEDTEXT_INVALID_SHAPE',
        error_message: 'Schema timedtext non valida',
      })
      throw new TranscriptFetchError('timedtext schema non valido', diagnosticAttempts)
    }
    const { text, segments } = parsedTimedtext
    attempts.push(`${client.clientName}(tracce:${trackCount ?? '?'})`)
    if (!text) {
      diagnosticAttempts.push({
        ...makeDiagnostic(attemptNo, client.clientName, 'timedtext', 'timedtext_empty'),
        player_http_status: playerResponse.status,
        player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
        player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
        ...fields,
        track_count: trackCount,
        usable_track_count: usableTrackCount,
        selected_track_language: sanitizeDiagnosticText(track.languageCode, 64),
        selected_track_kind: sanitizeDiagnosticText(track.kind ?? (isAsrTrack(track) ? 'asr' : 'standard'), 32),
        player_duration_ms: Date.now() - playerStartedAt,
        timedtext_http_status: timedtextResponse.status,
        timedtext_status_text: sanitizeDiagnosticText(timedtextResponse.statusText, 256),
        timedtext_content_type: sanitizeDiagnosticText(timedtextResponse.headers.get('content-type'), 128),
        timedtext_duration_ms: Date.now() - timedtextStartedAt,
        error_type: 'EmptyTimedtext',
        error_code: 'TIMEDTEXT_EMPTY',
        error_message: 'Timedtext senza segmenti utilizzabili',
      })
      return { transcript: null, diagnostics: attempts.join(' '), diagnosticAttempts }
    }

    const isAsr = isAsrTrack(track)
    diagnosticAttempts.push({
      ...makeDiagnostic(attemptNo, client.clientName, 'timedtext', 'fetched'),
      player_http_status: playerResponse.status,
      player_status_text: sanitizeDiagnosticText(playerResponse.statusText, 256),
      player_content_type: sanitizeDiagnosticText(playerResponse.headers.get('content-type'), 128),
      ...fields,
      track_count: trackCount,
      usable_track_count: usableTrackCount,
      selected_track_language: sanitizeDiagnosticText(track.languageCode, 64),
      selected_track_kind: sanitizeDiagnosticText(track.kind ?? (isAsr ? 'asr' : 'standard'), 32),
      player_duration_ms: Date.now() - playerStartedAt,
      timedtext_http_status: timedtextResponse.status,
      timedtext_status_text: sanitizeDiagnosticText(timedtextResponse.statusText, 256),
      timedtext_content_type: sanitizeDiagnosticText(timedtextResponse.headers.get('content-type'), 128),
      timedtext_duration_ms: Date.now() - timedtextStartedAt,
    })
    return {
      transcript: {
        language_code: track.languageCode,
        kind: isAsr ? 'asr' : 'standard',
        is_asr: isAsr,
        text,
        segments,
      },
      diagnostics: attempts.join(' '),
      diagnosticAttempts,
    }
  }

  if (!playerSucceeded) {
    throw new TranscriptFetchError(
      `youtubei player fallito su tutti i client: ${attempts.join(' ')}`,
      diagnosticAttempts
    )
  }

  return { transcript: null, diagnostics: attempts.join(' '), diagnosticAttempts }
}

/**
 * Crea la riga pending (lingua `unknown` finche il fetch non rivela quella reale).
 * Ignora le righe gia chiuse (fetched/legacy_missing) per idempotenza.
 */
export async function ensurePendingRow(
  admin: AdminClient,
  videoUuid: string,
  youtubeVideoId: string
): Promise<{ created: boolean }> {
  const { data: existing } = await admin
    .from('video_transcripts')
    .select('transcript_status')
    .eq('youtube_video_id', youtubeVideoId)

  const rows = (existing ?? []) as Array<{ transcript_status: string }>
  if (rows.some((row) => row.transcript_status === 'fetched' || row.transcript_status === 'legacy_missing')) {
    return { created: false }
  }

  await admin.from('video_transcripts').upsert(
    {
      video_id: videoUuid,
      youtube_video_id: youtubeVideoId,
      language_code: PENDING_LANGUAGE,
      kind: 'unknown',
      transcript_status: 'pending',
      source: 'youtubei-timedtext',
      error_details: null,
    },
    { onConflict: 'youtube_video_id,language_code' }
  )

  return { created: true }
}

function truncateError(message: string): string {
  return message.length > ERROR_DETAILS_MAX_LENGTH
    ? message.slice(0, ERROR_DETAILS_MAX_LENGTH)
    : message
}

/**
 * Fetch idempotente per un video: dedupica su UNIQUE, missing senza tracce,
 * failed con dettagli troncati, fetched con testo+segmenti (mai esposti ai view-model).
 */
export async function fetchAndStoreForVideo(
  admin: AdminClient,
  videoUuid: string,
  youtubeVideoId: string,
  fetchImpl: FetchImpl = fetch,
  requestId: string | null = null
): Promise<{ outcome: TranscriptOutcome }> {
  const { data: existing } = await admin
    .from('video_transcripts')
    .select('transcript_status')
    .eq('youtube_video_id', youtubeVideoId)

  const rows = (existing ?? []) as Array<{ transcript_status: string }>
  if (rows.some((row) => row.transcript_status === 'fetched' || row.transcript_status === 'legacy_missing')) {
    return { outcome: 'skipped' }
  }

  await ensurePendingRow(admin, videoUuid, youtubeVideoId)

  const fetchRunId = randomUUID()
  try {
    const { transcript, diagnostics, diagnosticAttempts } = await fetchMainTranscript(youtubeVideoId, fetchImpl, {
      fetchRunId,
      videoId: videoUuid,
      requestId,
    })

    await persistTranscriptDiagnostics(admin, diagnosticAttempts)

    if (!transcript) {
      await admin
        .from('video_transcripts')
        .update({ transcript_status: 'missing', error_details: truncateError(diagnostics) })
        .eq('youtube_video_id', youtubeVideoId)
      return { outcome: 'missing' }
    }

    await admin
      .from('video_transcripts')
      .update({
        language_code: transcript.language_code,
        kind: transcript.kind,
        is_asr: transcript.is_asr,
        transcript_status: 'fetched',
        transcript_text: transcript.text,
        segments: transcript.segments,
        fetched_at: new Date().toISOString(),
        error_details: null,
      })
      .eq('youtube_video_id', youtubeVideoId)
    return { outcome: 'fetched' }
  } catch (error) {
    if (error instanceof TranscriptFetchError) {
      await persistTranscriptDiagnostics(admin, error.diagnosticAttempts)
    }
    const message = error instanceof Error ? error.message : 'transcript_fetch_failed'
    await admin
      .from('video_transcripts')
      .update({ transcript_status: 'failed', error_details: truncateError(message) })
      .eq('youtube_video_id', youtubeVideoId)
    return { outcome: 'failed' }
  }
}

export interface PendingTranscriptsResult {
  success: boolean
  checked: number
  fetched: number
  missing: number
  failed: number
  skipped: number
}

/**
 * Processa fino a `limit` righe pending (usato dal cron giornaliero). Mai testo in output.
 */
export async function processPendingTranscripts(
  limit: number,
  fetchImpl: FetchImpl = fetch,
  options: { requestId?: string } = {}
): Promise<PendingTranscriptsResult> {
  const admin = createAdminClient()
  const { data: pending } = await admin
    .from('video_transcripts')
    .select('video_id,youtube_video_id')
    .eq('transcript_status', 'pending')
    .limit(limit)

  const rows = (pending ?? []) as Array<{ video_id: string; youtube_video_id: string }>
  const result: PendingTranscriptsResult = {
    success: true,
    checked: rows.length,
    fetched: 0,
    missing: 0,
    failed: 0,
    skipped: 0,
  }

  for (const row of rows) {
    const { outcome } = await fetchAndStoreForVideo(
      admin,
      row.video_id,
      row.youtube_video_id,
      fetchImpl,
      options.requestId ?? null
    )
    if (outcome === 'fetched') result.fetched += 1
    else if (outcome === 'missing') result.missing += 1
    else if (outcome === 'failed') result.failed += 1
    else result.skipped += 1
  }

  result.success = result.failed === 0
  return result
}
