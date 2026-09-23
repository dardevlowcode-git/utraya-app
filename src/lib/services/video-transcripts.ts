/* Commento didattico:
 * Scopo del file: fetch e cache delle trascrizioni YouTube solo per i NUOVI video (una lingua principale).
 * Moduli richiamati: `@/lib/supabase/admin` per client service_role (bypass RLS, mai esposto al browser).
 * Flusso: youtubei player ANDROID -> scelta 1 captionTrack -> timedtext fmt=json3 -> upsert su video_transcripts.
 */

import { createAdminClient } from '@/lib/supabase/admin'

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
  fetchImpl: FetchImpl = fetch
): Promise<{ transcript: MainTranscript | null; diagnostics: string }> {
  const apiKey = getYoutubeiKey()
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
  let playerSucceeded = false

  for (const client of clients) {
    let playerJson: {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } }
      playabilityStatus?: { status?: string }
    }
    try {
      const playerResponse = await fetchImpl(
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

      if (!playerResponse.ok) {
        attempts.push(`${client.clientName}(http:${playerResponse.status})`)
        continue
      }

      playerJson = (await playerResponse.json()) as typeof playerJson
      playerSucceeded = true
    } catch (error) {
      const short = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 60)
      attempts.push(`${client.clientName}(err:${short})`)
      continue
    }

    const tracks = playerJson.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    const play = playerJson.playabilityStatus?.status ?? '?'
    const track = pickMainTrack(tracks)
    if (!track) {
      attempts.push(`${client.clientName}(tracce:0,play:${play})`)
      continue
    }

    // Mai `tlang`: solo la lingua originale della traccia scelta.
    const timedtextUrl = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`
    // GET timedtext: stessi header realistici della POST, senza Content-Type (GET senza body).
    const timedtextHeaders = { ...clientHeaders[client.clientName] }
    delete timedtextHeaders['Content-Type']
    const timedtextResponse = await fetchImpl(timedtextUrl, {
      headers: timedtextHeaders,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!timedtextResponse.ok) {
      throw new Error(`timedtext status ${timedtextResponse.status}`)
    }

    const { text, segments } = parseJson3((await timedtextResponse.json()) as { events?: Json3Event[] })
    attempts.push(`${client.clientName}(tracce:${tracks.length})`)
    if (!text) return { transcript: null, diagnostics: attempts.join(' ') }

    const isAsr = isAsrTrack(track)
    return {
      transcript: {
        language_code: track.languageCode,
        kind: isAsr ? 'asr' : 'standard',
        is_asr: isAsr,
        text,
        segments,
      },
      diagnostics: attempts.join(' '),
    }
  }

  if (!playerSucceeded) {
    throw new Error(`youtubei player fallito su tutti i client: ${attempts.join(' ')}`)
  }

  return { transcript: null, diagnostics: attempts.join(' ') }
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
  fetchImpl: FetchImpl = fetch
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

  try {
    const { transcript, diagnostics } = await fetchMainTranscript(youtubeVideoId, fetchImpl)

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
  fetchImpl: FetchImpl = fetch
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
    const { outcome } = await fetchAndStoreForVideo(admin, row.video_id, row.youtube_video_id, fetchImpl)
    if (outcome === 'fetched') result.fetched += 1
    else if (outcome === 'missing') result.missing += 1
    else if (outcome === 'failed') result.failed += 1
    else result.skipped += 1
  }

  result.success = result.failed === 0
  return result
}
