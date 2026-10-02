/* Commento didattico:
 * Scopo: runner temporaneo usa-e-getta per UNA sola analisi Gemini nel DB DEV (run 2026-10-02-0253).
 * Moduli richiamati: Supabase admin, getter della credenziale profilo e fetch Gemini.
 * Flusso: seleziona un video non analizzato, riserva job idempotente, UNA chiamata Gemini senza retry, salva una riga video_analysis + una video_localized_content con readback.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import type { Database } from '@/lib/types/database'

export const GEMINI_SINGLE_PROBE_MODEL = 'gemini-3.5-flash-lite'
export const GEMINI_SINGLE_PROBE_RUN_ID = '2026-10-02-0253-singola-prova'
export const GEMINI_SINGLE_PROBE_JOB_TYPE = 'gemini_dev_single_probe'
export const GEMINI_SINGLE_PROBE_DEDUPE_KEY =
  'temporary-gemini-video-analysis:2026-10-02-0253-singola-prova'

export const GEMINI_SINGLE_TOKEN_ENV = 'GEMINI_SINGLE_TOKEN_20261002_0253'
export const GEMINI_SINGLE_PROFILE_ENV = 'GEMINI_SINGLE_PROFILE_20261002_0253'

const TOKEN_PATTERN = /^(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})$/
const MAX_TOKEN_LIFETIME_SECONDS = 900
const MAX_OUTPUT_TOKENS = 400
const CAPTURE_BODY_CAP_BYTES = 1_000_000

type VideoRow = Pick<
  Database['public']['Tables']['videos']['Row'],
  'id' | 'youtube_video_id' | 'video_url' | 'published_at' | 'availability_status' | 'video_type'
>

type GeminiInteractionResponse = {
  error?: { code?: number | string; status?: string }
  status?: string
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_tokens?: number }
}

export type SingleProbeSummary = {
  ok: true
  videoId: string
  summary: string
  durationMs: number
  analysisId: string
}

export type SingleProbeFailure = {
  ok: false
  failure: string
  httpStatus: number | null
  providerErrorCode: string | null
}

export type CapturedProbeResponse = {
  status: number
  headers: Record<string, string>
  bodyText: string
  truncated: boolean
}

export function isSingleProbeDevDeployment(): boolean {
  return process.env.VERCEL_ENV === 'production' && process.env.VERCEL_GIT_COMMIT_REF === 'dev'
}

export function isSingleProbeAuthorized(request: Request): boolean {
  const expected = process.env[GEMINI_SINGLE_TOKEN_ENV]
  if (!expected) return false
  const match = TOKEN_PATTERN.exec(expected)
  if (!match) return false
  const expirySeconds = Number(match[1])
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= nowSeconds) return false
  if (expirySeconds > nowSeconds + MAX_TOKEN_LIFETIME_SECONDS) return false
  const expectedBytes = Buffer.from(`Bearer ${expected}`, 'utf8')
  const receivedBytes = Buffer.from(request.headers.get('authorization') ?? '', 'utf8')
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

let claimedInThisRuntime = false

export function claimSingleProbeInThisRuntime(): boolean {
  if (claimedInThisRuntime) return false
  claimedInThisRuntime = true
  return true
}

export function resetSingleProbeRuntimeClaimForTests(): void {
  claimedInThisRuntime = false
}

export function selectEligibleSingleVideo(
  videos: VideoRow[],
  analyzedVideoIds: Set<string>,
  localizedVideoIds: Set<string>
): VideoRow | null {
  const eligible = videos
    .filter((video) => video.availability_status === 'available' && video.video_type === 'standard')
    .filter((video) => !analyzedVideoIds.has(video.id) && !localizedVideoIds.has(video.id))
  return eligible.length > 0 ? eligible[0] : null
}

export function extractSingleSummary(body: GeminiInteractionResponse | null): string {
  return (body?.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('\n')
    .trim()
}

export function makeSingleShortSummary(summary: string): string {
  const firstContentLine =
    summary
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}\]\s*/, '').trim())
      .find(Boolean) ?? ''
  const sentenceEnd = firstContentLine.search(/[.!?](?:\s|$)/)
  const firstSentence = sentenceEnd >= 0 ? firstContentLine.slice(0, sentenceEnd + 1) : firstContentLine
  return firstSentence.slice(0, 300)
}

function isMatchingYouTubeUrl(video: VideoRow): boolean {
  try {
    const url = new URL(video.video_url)
    const host = url.hostname.toLowerCase()
    const parsedId =
      host === 'youtu.be'
        ? (url.pathname.split('/').filter(Boolean)[0] ?? null)
        : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
          ? url.searchParams.get('v')
          : null
    return parsedId === video.youtube_video_id
  } catch {
    return false
  }
}

export async function requestSingleVideoSummary(params: {
  apiKey: string
  video: VideoRow
}): Promise<SingleProbeSummary | SingleProbeFailure> {
  if (!isMatchingYouTubeUrl(params.video)) {
    return { ok: false, failure: 'invalid_video_url', httpStatus: null, providerErrorCode: null }
  }
  const startedAt = Date.now()
  let response: Response
  try {
    // Prova temporanea: un solo tentativo, nessun retry. Il prodotto seguiterà SECURITY.md §9.
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': params.apiKey },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: GEMINI_SINGLE_PROBE_MODEL,
        store: false,
        input: [
          {
            type: 'text',
            text: 'Fornisci un riassunto conciso e cronologico in italiano. Usa al massimo due capitoli con timestamp [MM:SS], parafrasa fedelmente le idee principali, senza citazioni estese e senza aggiungere fatti. Se i timestamp non sono determinabili, non inventarli.',
          },
          { type: 'video', uri: params.video.video_url },
        ],
        generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
      }),
    })
  } catch {
    return { ok: false, failure: 'provider_network_or_timeout', httpStatus: null, providerErrorCode: null }
  }
  const body = (await response.json().catch(() => null)) as GeminiInteractionResponse | null
  const summary = extractSingleSummary(body)
  if (!response.ok || body?.status !== 'completed' || !summary) {
    return {
      ok: false,
      failure: 'provider_request_failed',
      httpStatus: response.status,
      providerErrorCode: body?.error?.status ?? body?.error?.code?.toString() ?? null,
    }
  }
  return {
    ok: true,
    videoId: params.video.youtube_video_id,
    summary,
    durationMs: Date.now() - startedAt,
    analysisId: '',
  }
}

/* Cattura status/header/body in memoria: stesso helper usato dal controller live (T3)
 * e dal dry-run offline. Il body è troncato al cap con flag esplicito. */
export async function captureProbedResponse(response: Response): Promise<CapturedProbeResponse> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  const fullText = await response.text()
  const truncated = Buffer.byteLength(fullText, 'utf8') > CAPTURE_BODY_CAP_BYTES
  let bodyText = fullText
  if (truncated) {
    let bytes = 0
    let cut = 0
    for (const char of fullText) {
      bytes += Buffer.byteLength(char, 'utf8')
      if (bytes > CAPTURE_BODY_CAP_BYTES) break
      cut += char.length
    }
    bodyText = fullText.slice(0, cut)
  }
  return { status: response.status, headers, bodyText, truncated }
}

export async function executeGeminiSingleProbe(): Promise<
  | { ok: true; jobId: string; model: string; analysisId: string; videoId: string }
  | SingleProbeFailure
> {
  const email = process.env[GEMINI_SINGLE_PROFILE_ENV]?.trim().toLowerCase()
  if (!email) return { ok: false, failure: 'profile_not_configured', httpStatus: null, providerErrorCode: null }

  const admin = createAdminClient()
  const { data: user, error: userError } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('status', 'active')
    .maybeSingle()
  if (userError || !user) return { ok: false, failure: 'profile_unavailable', httpStatus: null, providerErrorCode: null }

  const { data: followedChannels, error: channelsError } = await admin
    .from('user_channels')
    .select('channel_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
  if (channelsError) return { ok: false, failure: 'channel_inventory_unavailable', httpStatus: null, providerErrorCode: null }
  const channelIds = Array.from(new Set((followedChannels ?? []).map((row) => row.channel_id)))
  if (channelIds.length === 0) return { ok: false, failure: 'eligible_video_unavailable', httpStatus: null, providerErrorCode: null }

  const { data: videos, error: videosError } = await admin
    .from('videos')
    .select('id, youtube_video_id, video_url, published_at, availability_status, video_type')
    .in('channel_id', channelIds)
    .eq('availability_status', 'available')
    .eq('video_type', 'standard')
    .order('published_at', { ascending: false })
    .limit(250)
  if (videosError || !videos) return { ok: false, failure: 'video_inventory_unavailable', httpStatus: null, providerErrorCode: null }

  const videoIds = videos.map((video) => video.id)
  const [{ data: analyses }, { data: localized }] = await Promise.all([
    admin.from('video_analysis').select('video_id').in('video_id', videoIds),
    admin.from('video_localized_content').select('video_id').eq('language_code', 'it').in('video_id', videoIds),
  ])
  const video = selectEligibleSingleVideo(
    videos as VideoRow[],
    new Set((analyses ?? []).map((row) => row.video_id)),
    new Set((localized ?? []).map((row) => row.video_id))
  )
  if (!video) return { ok: false, failure: 'eligible_video_unavailable', httpStatus: null, providerErrorCode: null }

  // Chiave letta lato server dal profilo; mai da env Vercel, codice, log o test.
  const apiKey = (await getProviderApiKeyForUserAsAdmin(user.id, 'gemini')) ?? ''
  if (!apiKey) return { ok: false, failure: 'profile_gemini_key_unavailable', httpStatus: null, providerErrorCode: null }

  const analysisId = randomUUID()
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .insert({
      job_type: GEMINI_SINGLE_PROBE_JOB_TYPE,
      status: 'running',
      priority: 1,
      payload: { run_id: GEMINI_SINGLE_PROBE_RUN_ID, video_id: video.id, analysis_id: analysisId, language_code: 'it' },
      deduplication_key: GEMINI_SINGLE_PROBE_DEDUPE_KEY,
      created_by_user_id: user.id,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (jobError || !job) {
    return {
      ok: false,
      failure: jobError?.code === '23505' ? 'single_probe_already_claimed' : 'probe_job_reservation_failed',
      httpStatus: null,
      providerErrorCode: null,
    }
  }

  const { error: analysisError } = await admin.from('video_analysis').insert({
    id: analysisId,
    video_id: video.id,
    analysis_status: 'processing',
    model_used: GEMINI_SINGLE_PROBE_MODEL,
    analyzed_by_user_id: user.id,
  })
  if (analysisError) {
    await admin.from('jobs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', job.id)
    return { ok: false, failure: 'analysis_reservation_failed', httpStatus: null, providerErrorCode: null }
  }

  // UNICA chiamata provider della run, nessun retry.
  const gemini = await requestSingleVideoSummary({ apiKey, video })
  if (!gemini.ok) {
    await admin.from('video_analysis').update({ analysis_status: 'failed' }).eq('id', analysisId)
    await admin.from('jobs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', job.id)
    return gemini
  }

  const shortSummary = makeSingleShortSummary(gemini.summary)
  const { error: contentError } = await admin.from('video_localized_content').insert({
    video_analysis_id: analysisId,
    video_id: video.id,
    language_code: 'it',
    short_summary: shortSummary,
    full_summary: gemini.summary,
  })
  if (contentError) {
    await admin.from('video_localized_content').delete().eq('video_analysis_id', analysisId)
    await admin.from('video_analysis').delete().eq('id', analysisId)
    await admin.from('jobs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', job.id)
    return { ok: false, failure: 'localized_persistence_failed', httpStatus: null, providerErrorCode: null }
  }

  await admin
    .from('video_analysis')
    .update({ analysis_status: 'completed', analyzed_at: new Date().toISOString() })
    .eq('id', analysisId)

  // Readback: rilegge UNA riga video_analysis + UNA video_localized_content.
  const [{ data: readAnalysis }, { data: readContent }] = await Promise.all([
    admin.from('video_analysis').select('id, video_id, analysis_status, model_used').eq('id', analysisId).maybeSingle(),
    admin.from('video_localized_content').select('video_analysis_id, video_id, language_code, full_summary').eq('video_analysis_id', analysisId).maybeSingle(),
  ])
  const readbackOk =
    readAnalysis?.analysis_status === 'completed' &&
    readAnalysis.model_used === GEMINI_SINGLE_PROBE_MODEL &&
    readAnalysis.video_id === video.id &&
    readContent?.language_code === 'it' &&
    typeof readContent.full_summary === 'string' &&
    readContent.full_summary.length > 0
  if (!readbackOk) {
    return { ok: false, failure: 'readback_verification_failed', httpStatus: null, providerErrorCode: null }
  }

  await admin.from('jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', job.id)
  return { ok: true, jobId: job.id, model: GEMINI_SINGLE_PROBE_MODEL, analysisId, videoId: video.id }
}
