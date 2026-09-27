/* Commento didattico:
 * Scopo: runner interno usa-e-getta per due analisi Gemini nel DB DEV.
 * Moduli richiamati: Supabase admin, getter della credenziale profilo e fetch Gemini.
 * Flusso: seleziona due video non analizzati dei canali seguiti, riserva una job idempotente, genera e salva solo contenuti canonici/localizzati.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import type { Database } from '@/lib/types/database'

export const GEMINI_PROBE_MODEL = 'gemini-3.5-flash-lite'
export const GEMINI_PROBE_RUN_ID = '2026-09-28-0140-gemini-dev-due-analisi'

const TOKEN_ENV = 'GEMINI_DEV_ANALYSIS_TOKEN_20260928_0140'
const PROFILE_ENV = 'GEMINI_DEV_ANALYSIS_PROFILE_20260928_0140'
const TOKEN_PATTERN = /^(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})$/
const MAX_TOKEN_LIFETIME_SECONDS = 900
const VIDEO_PAGE_SIZE = 250
const MAX_OUTPUT_TOKENS = 400
const LANGUAGE_NAMES: Record<string, string> = { it: 'italiano', en: 'inglese' }
const JOB_DEDUPE_KEY = `temporary-gemini-video-analysis:${GEMINI_PROBE_RUN_ID}`

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

type GeminiSummary = {
  ok: true
  videoId: string
  summary: string
  durationMs: number
  timestampCount: number
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null
}

type CompletedProbeResult = GeminiSummary & { analysisId: string }

export type GeminiProbeBatchDiagnostics = {
  jobId?: string
  analysisIds: string[]
  completedAnalysisIds?: string[]
  failedAnalysisIds?: string[]
  unattemptedAnalysisIds?: string[]
  unattemptedAnalysisRowsDeleted?: boolean
  failedAnalysisRowsRecorded?: boolean
  localizedContentDeleted?: boolean
  analysisRowsDeleted?: boolean
  auditRecorded?: boolean
}

type BatchFailure = {
  ok: false
  failure: string
  httpStatus: number | null
  providerErrorCode: string | null
  diagnostics?: GeminiProbeBatchDiagnostics
}

export function isGeminiProbeDevDeployment(): boolean {
  return process.env.VERCEL_ENV === 'production' && process.env.VERCEL_GIT_COMMIT_REF === 'dev'
}

export function isGeminiProbeAuthorized(request: Request): boolean {
  const expected = process.env[TOKEN_ENV]
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

export function claimGeminiProbeInThisRuntime(): boolean {
  if (claimedInThisRuntime) return false
  claimedInThisRuntime = true
  return true
}

export function selectEligibleProbeVideos(
  videos: VideoRow[],
  analyzedVideoIds: Set<string>,
  localizedVideoIds: Set<string>
): VideoRow[] {
  return videos
    .filter((video) => video.availability_status === 'available' && video.video_type === 'standard')
    .filter((video) => !analyzedVideoIds.has(video.id) && !localizedVideoIds.has(video.id))
    .slice(0, 2)
}

function normalizeLanguage(value: string): 'it' | 'en' | null {
  const normalized = value.trim().toLowerCase().split('-')[0]
  return normalized === 'it' || normalized === 'en' ? normalized : null
}

function isMatchingYouTubeUrl(video: VideoRow): boolean {
  try {
    const url = new URL(video.video_url)
    const host = url.hostname.toLowerCase()
    const parsedId = host === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
        ? url.searchParams.get('v')
        : null
    return parsedId === video.youtube_video_id
  } catch {
    return false
  }
}

export function extractGeminiSummary(body: GeminiInteractionResponse | null): string {
  return (body?.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('\n')
    .trim()
}

export function makeShortSummary(summary: string): string {
  const firstContentLine = summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}\]\s*/, '').trim())
    .find(Boolean) ?? ''
  const sentenceEnd = firstContentLine.search(/[.!?](?:\s|$)/)
  const firstSentence = sentenceEnd >= 0 ? firstContentLine.slice(0, sentenceEnd + 1) : firstContentLine
  return firstSentence.slice(0, 300)
}

export async function requestGeminiVideoSummary(params: {
  apiKey: string
  video: VideoRow
  language: 'it' | 'en'
}): Promise<GeminiSummary | BatchFailure> {
  if (!isMatchingYouTubeUrl(params.video)) {
    return { ok: false, failure: 'invalid_video_url', httpStatus: null, providerErrorCode: null }
  }

  const startedAt = Date.now()
  let response: Response
  try {
    // Eccezione solo per la verifica temporanea: un solo tentativo per ciascuno dei due video autorizzati.
    // Il generatore di prodotto dovrà seguire SECURITY.md §9 con retry bounded/backoff per errori temporanei.
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': params.apiKey,
      },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: GEMINI_PROBE_MODEL,
        store: false,
        input: [
          {
            type: 'text',
            text: `Fornisci un riassunto conciso e cronologico in ${LANGUAGE_NAMES[params.language]}. Usa al massimo due capitoli con timestamp [MM:SS], parafrasa fedelmente le idee principali, senza citazioni estese e senza aggiungere fatti. Se i timestamp non sono determinabili, non inventarli.`,
          },
          { type: 'video', uri: params.video.video_url },
        ],
        generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
      }),
    })
  } catch {
    return { ok: false, failure: 'provider_network_or_timeout', httpStatus: null, providerErrorCode: null }
  }

  const body = await response.json().catch(() => null) as GeminiInteractionResponse | null
  const summary = extractGeminiSummary(body)
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
    timestampCount: (summary.match(/\[\d{1,2}:\d{2}\]/g) ?? []).length,
    usage: body.usage
      ? {
          inputTokens: body.usage.total_input_tokens ?? null,
          outputTokens: body.usage.total_output_tokens ?? null,
          totalTokens: body.usage.total_tokens ?? null,
        }
      : null,
  }
}

async function updateJob(admin: ReturnType<typeof createAdminClient>, jobId: string, succeeded: boolean, message?: string): Promise<boolean> {
  const { error } = await admin.from('jobs').update({
    status: succeeded ? 'completed' : 'failed',
    completed_at: new Date().toISOString(),
    error_message: message ?? null,
  }).eq('id', jobId)
  return !error
}

async function updateAttempt(
  admin: ReturnType<typeof createAdminClient>,
  attemptId: string,
  succeeded: boolean,
  message?: string,
  errorDetails?: Database['public']['Tables']['job_attempts']['Update']['error_details']
): Promise<boolean> {
  const { error } = await admin.from('job_attempts').update({
    status: succeeded ? 'completed' : 'failed',
    completed_at: new Date().toISOString(),
    error_message: message ?? null,
    error_details: errorDetails ?? null,
  }).eq('id', attemptId)
  return !error
}

async function failAnalyses(
  admin: ReturnType<typeof createAdminClient>,
  analysisIds: string[],
  message: string
): Promise<boolean> {
  if (analysisIds.length === 0) return true
  const { data, error } = await admin.from('video_analysis')
    .update({ analysis_status: 'failed', error_message: message })
    .in('id', analysisIds)
    .eq('analysis_status', 'processing')
    .select('id')
  return !error && data?.length === analysisIds.length
}

async function deleteUnattemptedAnalysisRows(
  admin: ReturnType<typeof createAdminClient>,
  analysisIds: string[]
): Promise<boolean> {
  if (analysisIds.length === 0) return true
  const { data, error } = await admin.from('video_analysis')
    .delete()
    .in('id', analysisIds)
    .eq('analysis_status', 'processing')
    .select('id')
  return !error && data?.length === analysisIds.length
}

async function rollbackCreatedAnalyses(
  admin: ReturnType<typeof createAdminClient>,
  analysisIds: string[]
): Promise<{ localizedContentDeleted: boolean; analysisRowsDeleted: boolean }> {
  if (analysisIds.length === 0) return { localizedContentDeleted: true, analysisRowsDeleted: true }

  let localizedContentDeleted = false
  let analysisRowsDeleted = false
  try {
    const { error } = await admin.from('video_localized_content').delete().in('video_analysis_id', analysisIds)
    localizedContentDeleted = !error
  } catch {
    localizedContentDeleted = false
  }
  if (!localizedContentDeleted) return { localizedContentDeleted, analysisRowsDeleted }

  try {
    const { error } = await admin.from('video_analysis').delete().in('id', analysisIds)
    analysisRowsDeleted = !error
  } catch {
    analysisRowsDeleted = false
  }
  return { localizedContentDeleted, analysisRowsDeleted }
}

async function failBatchAfterPersistenceError(params: {
  admin: ReturnType<typeof createAdminClient>
  jobId: string
  attemptId: string
  analysisIds: string[]
  completedAnalysisIds?: string[]
  reason: string
}): Promise<GeminiProbeBatchDiagnostics> {
  const rollback = await rollbackCreatedAnalyses(params.admin, params.analysisIds)
  const details = {
    run_id: GEMINI_PROBE_RUN_ID,
    analysis_ids: params.analysisIds,
    completed_analysis_ids: params.completedAnalysisIds ?? [],
    rollback_localized_content_deleted: rollback.localizedContentDeleted,
    rollback_analysis_rows_deleted: rollback.analysisRowsDeleted,
  }
  const [jobRecorded, attemptRecorded] = await Promise.all([
    updateJob(params.admin, params.jobId, false, params.reason),
    updateAttempt(params.admin, params.attemptId, false, params.reason, details),
  ])
  return {
    jobId: params.jobId,
    analysisIds: params.analysisIds,
    localizedContentDeleted: rollback.localizedContentDeleted,
    analysisRowsDeleted: rollback.analysisRowsDeleted,
    auditRecorded: jobRecorded && attemptRecorded,
  }
}

async function readBackPersistedResults(params: {
  admin: ReturnType<typeof createAdminClient>
  videos: VideoRow[]
  results: CompletedProbeResult[]
  language: 'it' | 'en'
}): Promise<CompletedProbeResult[] | null> {
  if (params.results.length === 0) return []
  const analysisIds = params.results.map((result) => result.analysisId)
  const [{ data: analyses, error: analysisError }, { data: content, error: contentError }] = await Promise.all([
    params.admin.from('video_analysis').select('id, video_id, analysis_status, model_used').in('id', analysisIds),
    params.admin.from('video_localized_content')
      .select('id, video_analysis_id, video_id, language_code, short_summary, full_summary')
      .in('video_analysis_id', analysisIds)
      .eq('language_code', params.language),
  ])
  if (analysisError || contentError || analyses?.length !== params.results.length || content?.length !== params.results.length) {
    return null
  }

  const analysisById = new Map(analyses.map((row) => [row.id, row]))
  const contentByAnalysisId = new Map(content.map((row) => [row.video_analysis_id, row]))
  const verified: CompletedProbeResult[] = []
  for (const result of params.results) {
    const analysis = analysisById.get(result.analysisId)
    const localized = contentByAnalysisId.get(result.analysisId)
    const video = params.videos.find((candidate) => candidate.youtube_video_id === result.videoId)
    if (
      !video
      || analysis?.analysis_status !== 'completed'
      || analysis.model_used !== GEMINI_PROBE_MODEL
      || analysis.video_id !== video.id
      || localized?.video_id !== video.id
      || localized.language_code !== params.language
      || !localized.full_summary
    ) {
      return null
    }
    verified.push({ ...result, summary: localized.full_summary })
  }
  return verified
}

async function findTwoEligibleVideos(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  language: 'it' | 'en'
): Promise<VideoRow[] | null> {
  const { data: followedChannels, error: channelsError } = await admin
    .from('user_channels')
    .select('channel_id')
    .eq('user_id', userId)
    .eq('is_active', true)
  if (channelsError) return null

  const channelIds = Array.from(new Set((followedChannels ?? []).map((row) => row.channel_id)))
  if (channelIds.length === 0) return []

  const eligible: VideoRow[] = []
  for (let offset = 0; ; offset += VIDEO_PAGE_SIZE) {
    const { data: videos, error: videosError } = await admin
      .from('videos')
      .select('id, youtube_video_id, video_url, published_at, availability_status, video_type')
      .in('channel_id', channelIds)
      .eq('availability_status', 'available')
      .eq('video_type', 'standard')
      .order('published_at', { ascending: false })
      .range(offset, offset + VIDEO_PAGE_SIZE - 1)
    if (videosError) return null
    if (!videos?.length) break

    const videoIds = videos.map((video) => video.id)
    const [{ data: analyses, error: analysesError }, { data: localized, error: localizedError }] = await Promise.all([
      admin.from('video_analysis').select('video_id').in('video_id', videoIds),
      admin.from('video_localized_content').select('video_id').eq('language_code', language).in('video_id', videoIds),
    ])
    if (analysesError || localizedError) return null

    eligible.push(...selectEligibleProbeVideos(
      videos as VideoRow[],
      new Set((analyses ?? []).map((row) => row.video_id)),
      new Set((localized ?? []).map((row) => row.video_id))
    ))
    if (eligible.length >= 2 || videos.length < VIDEO_PAGE_SIZE) break
  }
  return eligible.slice(0, 2)
}

export async function executeGeminiAnalysisProbeBatch(): Promise<{
  ok: true
  jobId: string
  model: string
  language: string
  results: CompletedProbeResult[]
} | BatchFailure> {
  let apiKey = ''
  let jobId: string | null = null
  let attemptId: string | null = null
  let reservedAnalysisIds: string[] = []
  let adminClient: ReturnType<typeof createAdminClient> | null = null

  try {
    const email = process.env[PROFILE_ENV]?.trim().toLowerCase()
    if (!email) return { ok: false, failure: 'profile_not_configured', httpStatus: null, providerErrorCode: null }

    const admin = createAdminClient()
    adminClient = admin
    const { data: user, error: userError } = await admin
      .from('users')
      .select('id, preferred_language')
      .eq('email', email)
      .eq('status', 'active')
      .maybeSingle()
    if (userError || !user) return { ok: false, failure: 'profile_unavailable', httpStatus: null, providerErrorCode: null }

    const language = normalizeLanguage(user.preferred_language)
    if (!language) return { ok: false, failure: 'unsupported_profile_language', httpStatus: null, providerErrorCode: null }

    const videos = await findTwoEligibleVideos(admin, user.id, language)
    if (!videos) return { ok: false, failure: 'video_inventory_unavailable', httpStatus: null, providerErrorCode: null }
    if (videos.length !== 2) return { ok: false, failure: 'two_eligible_videos_unavailable', httpStatus: null, providerErrorCode: null }

    apiKey = await getProviderApiKeyForUserAsAdmin(user.id, 'gemini') ?? ''
    if (!apiKey) return { ok: false, failure: 'profile_gemini_key_unavailable', httpStatus: null, providerErrorCode: null }

    const plannedAnalysisIds = videos.map(() => randomUUID())

    const { data: job, error: jobError } = await admin.from('jobs').insert({
      job_type: 'gemini_dev_analysis_probe',
      status: 'running',
      priority: 1,
      payload: {
        run_id: GEMINI_PROBE_RUN_ID,
        video_ids: videos.map((video) => video.id),
        analysis_ids: plannedAnalysisIds,
        language_code: language,
      },
      deduplication_key: JOB_DEDUPE_KEY,
      created_by_user_id: user.id,
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (jobError || !job) {
      return {
        ok: false,
        failure: jobError?.code === '23505' ? 'probe_batch_already_claimed' : 'probe_job_reservation_failed',
        httpStatus: null,
        providerErrorCode: null,
      }
    }
    jobId = job.id

    const { data: attempt, error: attemptError } = await admin.from('job_attempts').insert({
      job_id: job.id,
      attempt_number: 1,
      status: 'running',
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (attemptError || !attempt) {
      await updateJob(admin, job.id, false, 'probe_attempt_reservation_failed')
      return { ok: false, failure: 'probe_attempt_reservation_failed', httpStatus: null, providerErrorCode: null }
    }
    attemptId = attempt.id

    // Predetermined IDs let the catch/rollback find only this run's rows even if
    // PostgREST loses the insert response after the database committed it.
    reservedAnalysisIds = plannedAnalysisIds
    const { data: analyses, error: analysisError } = await admin.from('video_analysis').insert(
      videos.map((video, index) => ({
        id: plannedAnalysisIds[index],
        video_id: video.id,
        analysis_status: 'processing' as const,
        model_used: GEMINI_PROBE_MODEL,
        analyzed_by_user_id: user.id,
      }))
    ).select('id, video_id')
    if (
      analysisError
      || !analyses
      || analyses.length !== 2
      || analyses.some((analysis) => !plannedAnalysisIds.includes(analysis.id))
    ) {
      const diagnostics = await failBatchAfterPersistenceError({
        admin,
        jobId: job.id,
        attemptId: attempt.id,
        analysisIds: reservedAnalysisIds,
        reason: 'analysis_reservation_failed',
      })
      return { ok: false, failure: 'analysis_reservation_failed', httpStatus: null, providerErrorCode: null, diagnostics }
    }

    const results: CompletedProbeResult[] = []
    for (const video of videos) {
      const analysis = analyses.find((row) => row.video_id === video.id)
      if (!analysis) {
        const diagnostics = await failBatchAfterPersistenceError({
          admin,
          jobId: job.id,
          attemptId: attempt.id,
          analysisIds: reservedAnalysisIds,
          reason: 'analysis_reservation_incomplete',
        })
        return { ok: false, failure: 'analysis_reservation_incomplete', httpStatus: null, providerErrorCode: null, diagnostics }
      }

      const summary = await requestGeminiVideoSummary({ apiKey, video, language })
      if (!summary.ok) {
        const persistedCompleted = await readBackPersistedResults({ admin, videos, results, language })
        if (!persistedCompleted) {
          const diagnostics = await failBatchAfterPersistenceError({
            admin,
            jobId: job.id,
            attemptId: attempt.id,
            analysisIds: reservedAnalysisIds,
            completedAnalysisIds: results.map((item) => item.analysisId),
            reason: 'partial_database_readback_verification_failed',
          })
          return { ok: false, failure: 'partial_database_readback_verification_failed', httpStatus: null, providerErrorCode: null, diagnostics }
        }
        const completedAnalysisIds = persistedCompleted.map((item) => item.analysisId)
        const failedAnalysisIds = [analysis.id]
        const unattemptedAnalysisIds = reservedAnalysisIds.filter(
          (id) => !completedAnalysisIds.includes(id) && !failedAnalysisIds.includes(id)
        )
        const [failedAnalysisRowsRecorded, unattemptedAnalysisRowsDeleted] = await Promise.all([
          failAnalyses(admin, failedAnalysisIds, summary.failure),
          deleteUnattemptedAnalysisRows(admin, unattemptedAnalysisIds),
        ])
        const [jobRecorded, attemptRecorded] = await Promise.all([
          updateJob(admin, job.id, false, summary.failure),
          updateAttempt(admin, attempt.id, false, summary.failure, {
            run_id: GEMINI_PROBE_RUN_ID,
            analysis_ids: reservedAnalysisIds,
            completed_analysis_ids: completedAnalysisIds,
            completed_video_ids: persistedCompleted.map((item) => item.videoId),
            failed_analysis_ids: failedAnalysisIds,
            unattempted_analysis_ids: unattemptedAnalysisIds,
            failed_analysis_rows_recorded: failedAnalysisRowsRecorded,
            unattempted_analysis_rows_deleted: unattemptedAnalysisRowsDeleted,
          }),
        ])
        return {
          ...summary,
          diagnostics: {
            jobId: job.id,
            analysisIds: reservedAnalysisIds,
            completedAnalysisIds,
            failedAnalysisIds,
            unattemptedAnalysisIds,
            unattemptedAnalysisRowsDeleted,
            failedAnalysisRowsRecorded,
            auditRecorded: jobRecorded && attemptRecorded && failedAnalysisRowsRecorded && unattemptedAnalysisRowsDeleted,
          },
        }
      }

      const { data: localizedRow, error: localizedError } = await admin.from('video_localized_content').insert({
        video_analysis_id: analysis.id,
        video_id: video.id,
        language_code: language,
        short_summary: makeShortSummary(summary.summary),
        full_summary: summary.summary,
        general_category: null,
        subcategory: null,
        highlights_text: summary.timestampCount > 0 ? summary.summary : null,
        is_admin_edited: false,
      }).select('id').single()
      if (localizedError || !localizedRow) {
        const diagnostics = await failBatchAfterPersistenceError({
          admin,
          jobId: job.id,
          attemptId: attempt.id,
          analysisIds: reservedAnalysisIds,
          reason: 'localized_content_persist_failed',
        })
        return { ok: false, failure: 'localized_content_persist_failed', httpStatus: null, providerErrorCode: null, diagnostics }
      }

      const { data: completedAnalysis, error: completionError } = await admin.from('video_analysis').update({
        analysis_status: 'completed',
        analyzed_at: new Date().toISOString(),
        error_message: null,
      }).eq('id', analysis.id).eq('analysis_status', 'processing').select('id').maybeSingle()
      if (completionError || !completedAnalysis) {
        const diagnostics = await failBatchAfterPersistenceError({
          admin,
          jobId: job.id,
          attemptId: attempt.id,
          analysisIds: reservedAnalysisIds,
          reason: 'analysis_completion_persist_failed',
        })
        return { ok: false, failure: 'analysis_completion_persist_failed', httpStatus: null, providerErrorCode: null, diagnostics }
      }

      results.push({ ...summary, analysisId: analysis.id })
    }

    const persistedResults = await readBackPersistedResults({ admin, videos, results, language })
    if (!persistedResults || persistedResults.length !== 2) {
      const diagnostics = await failBatchAfterPersistenceError({
        admin,
        jobId: job.id,
        attemptId: attempt.id,
        analysisIds: reservedAnalysisIds,
        completedAnalysisIds: results.map((item) => item.analysisId),
        reason: 'database_readback_verification_failed',
      })
      return { ok: false, failure: 'database_readback_verification_failed', httpStatus: null, providerErrorCode: null, diagnostics }
    }
    const analysisIds = persistedResults.map((item) => item.analysisId)

    const [jobFinalized, attemptFinalized] = await Promise.all([
      updateJob(admin, job.id, true),
      updateAttempt(admin, attempt.id, true),
    ])
    if (!jobFinalized || !attemptFinalized) {
      return {
        ok: false,
        failure: 'probe_audit_finalization_failed',
        httpStatus: null,
        providerErrorCode: null,
        diagnostics: {
          jobId: job.id,
          analysisIds,
          completedAnalysisIds: analysisIds,
          auditRecorded: false,
        },
      }
    }
    return { ok: true, jobId: job.id, model: GEMINI_PROBE_MODEL, language, results: persistedResults }
  } catch {
    let diagnostics: GeminiProbeBatchDiagnostics | undefined
    if (adminClient && jobId && attemptId && reservedAnalysisIds.length > 0) {
      diagnostics = await failBatchAfterPersistenceError({
        admin: adminClient,
        jobId,
        attemptId,
        analysisIds: reservedAnalysisIds,
        reason: 'probe_execution_failed',
      })
    } else if (adminClient && jobId) {
      await updateJob(adminClient, jobId, false, 'probe_execution_failed')
    }
    return { ok: false, failure: 'probe_execution_failed', httpStatus: null, providerErrorCode: null, diagnostics }
  } finally {
    apiKey = ''
  }
}
