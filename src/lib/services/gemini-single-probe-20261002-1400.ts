/* Commento didattico:
 * Scopo: esegue una sola analisi Gemini temporanea in DEV, con prenotazione idempotente e persistenza minima.
 * Moduli richiamati: Supabase admin, getter server-side della chiave profilo, crypto e Gemini Interactions API.
 * Flusso: risolve un profilo univoco, sceglie un video idoneo, riserva il job, invia una richiesta senza retry e verifica i record via readback.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import type { Database } from '@/lib/types/database'

export const GEMINI_SINGLE_PROBE_MODEL = 'gemini-3.5-flash-lite'
export const GEMINI_SINGLE_PROBE_RUN_ID = '2026-10-02-1400-singola-prova'
export const GEMINI_SINGLE_PROBE_JOB_TYPE = 'gemini_dev_single_probe'
export const GEMINI_SINGLE_PROBE_DEDUPE_KEY =
  'temporary-gemini-video-analysis:2026-10-02-1400-singola-prova'
export const GEMINI_SINGLE_TOKEN_ENV = 'GEMINI_SINGLE_TOKEN_20261002_1400'

const TOKEN_PATTERN = /^(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})$/
const MAX_TOKEN_LIFETIME_SECONDS = 900
const MAX_OUTPUT_TOKENS = 400
const PROBE_LANGUAGE = 'it'

type VideoRow = Pick<
  Database['public']['Tables']['videos']['Row'],
  'id' | 'youtube_video_id' | 'video_url' | 'published_at' | 'availability_status' | 'video_type'
>

type GeminiInteractionResponse = {
  error?: { code?: number | string; status?: string }
  status?: string
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  usage?: {
    total_input_tokens?: number
    total_output_tokens?: number
    total_tokens?: number
  }
}

type ProbeFailure = {
  ok: false
  failure: string
  httpStatus: number | null
  providerErrorCode: string | null
}

type CandidateResult =
  | { ok: true; admin: ReturnType<typeof createAdminClient>; userId: string; video: VideoRow }
  | { ok: false; failure: string }

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

function isMatchingYouTubeUrl(video: VideoRow): boolean {
  try {
    const url = new URL(video.video_url)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
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

export function selectEligibleSingleVideo(
  videos: VideoRow[],
  analyzedVideoIds: Set<string>,
  localizedVideoIds: Set<string>
): VideoRow | null {
  const eligible = videos
    .filter((video) => video.availability_status === 'available' && video.video_type === 'standard')
    .filter((video) => !analyzedVideoIds.has(video.id) && !localizedVideoIds.has(video.id))
    .filter(isMatchingYouTubeUrl)
  return eligible[0] ?? null
}

function extractSingleSummary(body: GeminiInteractionResponse | null): string {
  return (body?.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('\n')
    .trim()
}

function makeSingleShortSummary(summary: string): string {
  const firstContentLine =
    summary
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}\]\s*/, '').trim())
      .find(Boolean) ?? ''
  const sentenceEnd = firstContentLine.search(/[.!?](?:\s|$)/)
  const firstSentence = sentenceEnd >= 0 ? firstContentLine.slice(0, sentenceEnd + 1) : firstContentLine
  return firstSentence.slice(0, 300)
}

async function findProbeCandidate(): Promise<CandidateResult> {
  const admin = createAdminClient()
  const { data: credentialRows, error: credentialsError } = await admin
    .from('user_provider_credentials')
    .select('user_id')
    .eq('provider', 'gemini')
    .eq('is_configured', true)

  if (credentialsError) return { ok: false, failure: 'profile_inventory_unavailable' }
  const credentialUserIds = Array.from(new Set((credentialRows ?? []).map((row) => row.user_id)))
  if (credentialUserIds.length === 0) return { ok: false, failure: 'profile_unavailable' }

  const { data: activeUsers, error: usersError } = await admin
    .from('users')
    .select('id')
    .eq('status', 'active')
    .in('id', credentialUserIds)
  if (usersError) return { ok: false, failure: 'profile_inventory_unavailable' }

  const activeUserIds = Array.from(new Set((activeUsers ?? []).map((row) => row.id)))
  if (activeUserIds.length !== 1) {
    return { ok: false, failure: activeUserIds.length === 0 ? 'profile_unavailable' : 'profile_ambiguous' }
  }
  const userId = activeUserIds[0]

  const { data: followedChannels, error: channelsError } = await admin
    .from('user_channels')
    .select('channel_id')
    .eq('user_id', userId)
    .eq('is_active', true)
  if (channelsError) return { ok: false, failure: 'channel_inventory_unavailable' }

  const channelIds = Array.from(new Set((followedChannels ?? []).map((row) => row.channel_id)))
  if (channelIds.length === 0) return { ok: false, failure: 'eligible_video_unavailable' }

  const { data: videos, error: videosError } = await admin
    .from('videos')
    .select('id, youtube_video_id, video_url, published_at, availability_status, video_type')
    .in('channel_id', channelIds)
    .eq('availability_status', 'available')
    .eq('video_type', 'standard')
    .order('published_at', { ascending: false })
    .limit(250)
  if (videosError || !videos) return { ok: false, failure: 'video_inventory_unavailable' }

  const videoIds = videos.map((video) => video.id)
  if (videoIds.length === 0) return { ok: false, failure: 'eligible_video_unavailable' }

  const [analysisResult, localizedResult] = await Promise.all([
    admin.from('video_analysis').select('video_id').in('video_id', videoIds),
    admin.from('video_localized_content').select('video_id').eq('language_code', PROBE_LANGUAGE).in('video_id', videoIds),
  ])
  if (analysisResult.error || localizedResult.error) return { ok: false, failure: 'analysis_inventory_unavailable' }

  const video = selectEligibleSingleVideo(
    videos as VideoRow[],
    new Set((analysisResult.data ?? []).map((row) => row.video_id)),
    new Set((localizedResult.data ?? []).map((row) => row.video_id))
  )
  if (!video) return { ok: false, failure: 'eligible_video_unavailable' }

  return { ok: true, admin, userId, video }
}

function getUsage(body: GeminiInteractionResponse | null) {
  const usage = body?.usage
  return {
    inputTokens: Number.isFinite(usage?.total_input_tokens) ? usage?.total_input_tokens ?? null : null,
    outputTokens: Number.isFinite(usage?.total_output_tokens) ? usage?.total_output_tokens ?? null : null,
    totalTokens: Number.isFinite(usage?.total_tokens) ? usage?.total_tokens ?? null : null,
  }
}

export async function requestSingleVideoSummary(params: {
  apiKey: string
  video: VideoRow
}): Promise<
  | { ok: true; summary: string; durationMs: number; usage: ReturnType<typeof getUsage> }
  | ProbeFailure
> {
  const startedAt = Date.now()
  let response: Response
  try {
    // Unico tentativo Gemini del run: nessun retry; la chiave resta nell'header server-side.
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
            text: 'Riassumi in italiano il contenuto del video con una sintesi breve, fedele e riformulata. Non trascrivere, non citare frasi estese e non aggiungere informazioni non presenti. Organizza il risultato in massimo due punti tematici; includi timestamp solo se determinabili con affidabilità, altrimenti omettili.',
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

  return { ok: true, summary, durationMs: Date.now() - startedAt, usage: getUsage(body) }
}

export async function getGeminiSingleProbeReadiness() {
  const candidate = await findProbeCandidate()
  if (!candidate.ok) return { ok: false as const, mode: 'ready' as const, ready: false, failure: candidate.failure }

  try {
    const apiKey = await getProviderApiKeyForUserAsAdmin(candidate.userId, 'gemini')
    if (!apiKey) {
      return { ok: false as const, mode: 'ready' as const, ready: false, failure: 'profile_gemini_key_unavailable' }
    }
  } catch {
    return { ok: false as const, mode: 'ready' as const, ready: false, failure: 'profile_gemini_key_unavailable' }
  }

  return {
    ok: true as const,
    mode: 'ready' as const,
    ready: true,
    model: GEMINI_SINGLE_PROBE_MODEL,
    eligibleVideoAvailable: true,
    languageCode: PROBE_LANGUAGE,
  }
}

export async function getGeminiSingleProbeReadback() {
  const admin = createAdminClient()
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id, status, payload, created_at, completed_at')
    .eq('deduplication_key', GEMINI_SINGLE_PROBE_DEDUPE_KEY)
    .maybeSingle()
  if (jobError) return { ok: false as const, mode: 'readback' as const, failure: 'readback_unavailable' }
  if (!job) return null

  const payload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
    ? job.payload as Record<string, unknown>
    : {}
  const analysisId = typeof payload.analysis_id === 'string' ? payload.analysis_id : null
  if (!analysisId) {
    return {
      ok: false as const,
      mode: 'readback' as const,
      jobId: job.id,
      jobStatus: job.status,
      failure: 'readback_analysis_reference_missing',
    }
  }

  const [analysisResult, localizedResult] = await Promise.all([
    admin
      .from('video_analysis')
      .select('id, analysis_status, model_used, analyzed_at, created_at')
      .eq('id', analysisId)
      .maybeSingle(),
    admin
      .from('video_localized_content')
      .select('id, language_code, created_at')
      .eq('video_analysis_id', analysisId),
  ])
  if (analysisResult.error || localizedResult.error) {
    return { ok: false as const, mode: 'readback' as const, jobId: job.id, jobStatus: job.status, failure: 'readback_unavailable' }
  }

  return {
    ok: true as const,
    mode: 'readback' as const,
    jobId: job.id,
    jobStatus: job.status,
    analysisId,
    analysisStatus: analysisResult.data?.analysis_status ?? null,
    model: analysisResult.data?.model_used ?? null,
    analysisCreatedAt: analysisResult.data?.created_at ?? null,
    analyzedAt: analysisResult.data?.analyzed_at ?? null,
    localizedCount: localizedResult.data?.length ?? 0,
    localizedLanguage: localizedResult.data?.[0]?.language_code ?? null,
    localizedCreatedAt: localizedResult.data?.[0]?.created_at ?? null,
    jobCreatedAt: job.created_at,
    jobCompletedAt: job.completed_at,
  }
}

async function markProbeFailed(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  analysisId: string,
  failure: string
): Promise<void> {
  const completedAt = new Date().toISOString()
  await Promise.all([
    admin.from('video_analysis').update({ analysis_status: 'failed' }).eq('id', analysisId),
    admin.from('jobs').update({ status: 'failed', completed_at: completedAt, error_message: failure }).eq('id', jobId),
  ])
}

export async function executeGeminiSingleProbe(): Promise<
  | {
      ok: true
      jobId: string
      analysisId: string
      model: string
      languageCode: string
      analyzedAt: string
      durationMs: number
      usage: ReturnType<typeof getUsage>
    }
  | ProbeFailure
> {
  const candidate = await findProbeCandidate()
  if (!candidate.ok) {
    return { ok: false, failure: candidate.failure, httpStatus: null, providerErrorCode: null }
  }

  let apiKey: string | null
  try {
    apiKey = await getProviderApiKeyForUserAsAdmin(candidate.userId, 'gemini')
  } catch {
    return { ok: false, failure: 'profile_gemini_key_unavailable', httpStatus: null, providerErrorCode: null }
  }
  if (!apiKey) return { ok: false, failure: 'profile_gemini_key_unavailable', httpStatus: null, providerErrorCode: null }

  const analysisId = randomUUID()
  const startedAt = new Date().toISOString()
  const { data: job, error: jobError } = await candidate.admin
    .from('jobs')
    .insert({
      job_type: GEMINI_SINGLE_PROBE_JOB_TYPE,
      status: 'running',
      priority: 1,
      payload: {
        run_id: GEMINI_SINGLE_PROBE_RUN_ID,
        video_id: candidate.video.id,
        analysis_id: analysisId,
        language_code: PROBE_LANGUAGE,
      },
      deduplication_key: GEMINI_SINGLE_PROBE_DEDUPE_KEY,
      created_by_user_id: candidate.userId,
      started_at: startedAt,
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

  const { error: analysisError } = await candidate.admin.from('video_analysis').insert({
    id: analysisId,
    video_id: candidate.video.id,
    analysis_status: 'processing',
    model_used: GEMINI_SINGLE_PROBE_MODEL,
    analyzed_by_user_id: candidate.userId,
  })
  if (analysisError) {
    await candidate.admin
      .from('jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: 'analysis_reservation_failed' })
      .eq('id', job.id)
    return { ok: false, failure: 'analysis_reservation_failed', httpStatus: null, providerErrorCode: null }
  }

  // L'unica richiesta al provider viene eseguita dopo aver acquisito la chiave idempotente nel DB.
  const gemini = await requestSingleVideoSummary({ apiKey, video: candidate.video })
  apiKey = null
  if (!gemini.ok) {
    await markProbeFailed(candidate.admin, job.id, analysisId, gemini.failure)
    return gemini
  }

  const { error: contentError } = await candidate.admin.from('video_localized_content').insert({
    video_analysis_id: analysisId,
    video_id: candidate.video.id,
    language_code: PROBE_LANGUAGE,
    short_summary: makeSingleShortSummary(gemini.summary),
    full_summary: gemini.summary,
  })
  if (contentError) {
    await markProbeFailed(candidate.admin, job.id, analysisId, 'localized_persistence_failed')
    return { ok: false, failure: 'localized_persistence_failed', httpStatus: null, providerErrorCode: null }
  }

  const analyzedAt = new Date().toISOString()
  const { error: completionError } = await candidate.admin
    .from('video_analysis')
    .update({ analysis_status: 'completed', analyzed_at: analyzedAt })
    .eq('id', analysisId)
  if (completionError) {
    await candidate.admin
      .from('jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: 'analysis_completion_failed' })
      .eq('id', job.id)
    return { ok: false, failure: 'analysis_completion_failed', httpStatus: null, providerErrorCode: null }
  }

  const readback = await getGeminiSingleProbeReadback()
  const readbackOk =
    readback?.ok === true &&
    readback.jobId === job.id &&
    readback.analysisId === analysisId &&
    readback.jobStatus === 'running' &&
    readback.analysisStatus === 'completed' &&
    readback.model === GEMINI_SINGLE_PROBE_MODEL &&
    readback.localizedCount === 1 &&
    readback.localizedLanguage === PROBE_LANGUAGE
  if (!readbackOk) {
    await candidate.admin
      .from('jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: 'readback_verification_failed' })
      .eq('id', job.id)
    return { ok: false, failure: 'readback_verification_failed', httpStatus: null, providerErrorCode: null }
  }

  const { error: jobCompletionError } = await candidate.admin
    .from('jobs')
    .update({ status: 'completed', completed_at: new Date().toISOString(), error_message: null })
    .eq('id', job.id)
  if (jobCompletionError) {
    return { ok: false, failure: 'job_completion_failed', httpStatus: null, providerErrorCode: null }
  }

  return {
    ok: true,
    jobId: job.id,
    analysisId,
    model: GEMINI_SINGLE_PROBE_MODEL,
    languageCode: PROBE_LANGUAGE,
    analyzedAt,
    durationMs: gemini.durationMs,
    usage: gemini.usage,
  }
}
