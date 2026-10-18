/* Commento didattico:
 * Scopo del file: casi d'uso della trascrizione su richiesta (richiesta, stato per la pagina, recupero job).
 * Moduli richiamati: client Supabase utente (RLS) e admin, servizio di trascrizione, view model.
 * Flusso: la route valida e autentica, qui si applicano le regole (follower, chiave Gemini personale, riuso canonico),
 * si crea trascrizione+parti+job e si lascia al chiamante il lavoro in `after()` tramite `runTranscriptionJobNow`.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { AppSupabaseClient } from '@/lib/supabase/types'
import {
  buildTranscriptionParts,
  parseTranscriptionJobPayload,
  runTranscriptionJob,
  TRANSCRIPTION_CHUNK_SECONDS,
  TRANSCRIPTION_JOB_TYPE,
  type ThinkingLevel,
  type TranscriptionRunResult,
  type TranscriptionStatus,
  type TranscriptionWorkerDeps,
} from '@/lib/services/transcription'
import {
  createSupabaseTranscriptionStore,
  requestTranscriptionContinuation,
} from '@/lib/services/transcription-store'
import { toTranscriptionViewModel, type TranscriptionViewModel } from '@/lib/view-models/transcription'
import { AppError } from '@/lib/utils/errors'
import { extractYouTubeVideoId } from '@/lib/utils/youtube-video-id'

type AdminClient = ReturnType<typeof createAdminClient>

export type TranscriptionErrorCode = 'GEMINI_KEY_REQUIRED' | 'TRANSCRIPTION_UNAVAILABLE'

export interface FollowedVideo {
  id: string
  channel_id: string
  youtube_video_id: string
  video_url: string
  duration_seconds: number | null
  availability_status: 'available' | 'unavailable' | 'private'
}

export interface RequestTranscriptionResult {
  jobId: string | null
  transcriptionStatus: TranscriptionStatus
  /** True se il chiamante deve avviare il worker in `after()`. */
  shouldRun: boolean
  reused: boolean
}

const PAGE_SIZE = 1000
/** Il recupero legge più righe del limite per saltare i job automatici in attesa di una chiave. */
const RECOVERY_SCAN_FACTOR = 10
const DEFAULT_PROFILE = { model: 'gemini-3.1-flash-lite', thinking_level: 'minimal' as ThinkingLevel }

/** Errore applicativo con codice stabile esposto dalla route. */
function codedError(message: string, code: TranscriptionErrorCode, status: number, type: 'forbidden' | 'validation'): AppError {
  return new AppError(message, type, status, { code })
}

/** Carica il video e verifica che l'utente segua il canale (404 se assente, 403 se non follower). */
export async function loadFollowedVideo(params: {
  supabase: AppSupabaseClient
  userId: string
  videoId: string
}): Promise<FollowedVideo> {
  const { data: video, error } = await params.supabase
    .from('videos')
    .select('id, channel_id, youtube_video_id, video_url, duration_seconds, availability_status')
    .eq('id', params.videoId)
    .maybeSingle()
  if (error) throw new AppError('Impossibile leggere il video', 'unknown', 500, { cause: error.message })
  if (!video) throw new AppError('Video non trovato', 'not_found', 404)

  const { data: followed, error: followError } = await params.supabase
    .from('user_channels')
    .select('id')
    .eq('user_id', params.userId)
    .eq('channel_id', video.channel_id)
    .eq('is_active', true)
    .maybeSingle()
  if (followError) throw new AppError('Impossibile verificare il canale', 'unknown', 500, { cause: followError.message })
  if (!followed) throw new AppError('Canale non seguito', 'forbidden', 403)
  return video
}

/** Vero se l'utente ha una chiave Gemini personale configurata e non invalidata. */
async function hasUsableGeminiKey(client: AppSupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from('user_provider_credentials')
    .select('is_configured, is_valid')
    .eq('user_id', userId)
    .eq('provider', 'gemini')
    .maybeSingle()
  if (error) throw new AppError('Impossibile leggere le credenziali', 'unknown', 500, { cause: error.message })
  return Boolean(data?.is_configured && data.is_valid !== false)
}

/** Job attivo (pending/running) per il video, con la scadenza della lease. */
async function findActiveJob(admin: AdminClient, videoId: string) {
  const { data, error } = await admin
    .from('jobs')
    .select('id, status, lease_expires_at')
    .eq('job_type', TRANSCRIPTION_JOB_TYPE)
    .eq('payload->>videoId', videoId)
    .in('status', ['pending', 'running'])
    .limit(1)
    .maybeSingle()
  if (error) throw new AppError('Impossibile leggere il job di trascrizione', 'unknown', 500, { cause: error.message })
  return data
}

function isLeaseLive(job: { status: string; lease_expires_at: string | null }, nowMs = Date.now()): boolean {
  return job.status === 'running' && job.lease_expires_at !== null && new Date(job.lease_expires_at).getTime() > nowMs
}

/**
 * Richiede la trascrizione con la chiave Gemini di chi richiede (nessuna rotazione): riusa il canonico esistente,
 * altrimenti crea trascrizione, parti e job e indica al chiamante se avviare il worker.
 */
export async function requestTranscriptionForUser(params: {
  supabase: AppSupabaseClient
  userId: string
  videoId: string
  admin?: AdminClient
}): Promise<RequestTranscriptionResult> {
  const admin = params.admin ?? createAdminClient()
  const video = await loadFollowedVideo(params)

  const { data: existing, error: existingError } = await admin
    .from('transcriptions')
    .select('id, status')
    .eq('video_id', video.id)
    .maybeSingle()
  if (existingError) throw new AppError('Impossibile leggere la trascrizione', 'unknown', 500, { cause: existingError.message })

  if (existing && (existing.status === 'complete' || existing.status === 'needs_review')) {
    return { jobId: null, transcriptionStatus: existing.status, shouldRun: false, reused: true }
  }

  if (!(await hasUsableGeminiKey(admin as unknown as AppSupabaseClient, params.userId))) {
    throw codedError('Serve una chiave Gemini personale valida', 'GEMINI_KEY_REQUIRED', 403, 'forbidden')
  }

  const { data: profile, error: profileError } = await admin
    .from('transcription_profile')
    .select('model, thinking_level')
    .eq('id', true)
    .maybeSingle()
  if (profileError) throw new AppError('Impossibile leggere il profilo di trascrizione', 'unknown', 500, { cause: profileError.message })
  const model = profile?.model ?? DEFAULT_PROFILE.model
  const thinkingLevel = profile?.thinking_level ?? DEFAULT_PROFILE.thinking_level

  const duration = video.duration_seconds ?? 0
  const youtubeVideoId = extractYouTubeVideoId(video.youtube_video_id) ?? extractYouTubeVideoId(video.video_url)
  if (video.availability_status !== 'available' || duration <= 0 || !youtubeVideoId) {
    if (existing) {
      await admin.from('transcriptions').update({ status: 'unavailable', updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      await admin.from('transcriptions').insert({
        video_id: video.id, status: 'unavailable', model, thinking_level: thinkingLevel,
        requested_by_user_id: params.userId, chunk_seconds: TRANSCRIPTION_CHUNK_SECONDS,
      })
    }
    throw codedError('Video non trascrivibile', 'TRANSCRIPTION_UNAVAILABLE', 422, 'validation')
  }

  let transcriptionId = existing?.id ?? null
  if (!transcriptionId) {
    const { data: created, error: createError } = await admin
      .from('transcriptions')
      .insert({
        video_id: video.id, status: 'pending', model, thinking_level: thinkingLevel,
        requested_by_user_id: params.userId, chunk_seconds: TRANSCRIPTION_CHUNK_SECONDS,
      })
      .select('id')
      .single()
    if (createError?.code === '23505') {
      const { data: raced } = await admin.from('transcriptions').select('id').eq('video_id', video.id).maybeSingle()
      transcriptionId = raced?.id ?? null
    } else if (createError || !created) {
      throw new AppError('Impossibile creare la trascrizione', 'unknown', 500, { cause: createError?.message })
    } else {
      transcriptionId = created.id
    }
  } else if (existing?.status === 'unavailable') {
    await admin.from('transcriptions').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', transcriptionId)
  }
  if (!transcriptionId) throw new AppError('Impossibile creare la trascrizione', 'unknown', 500)

  // Le parti già presenti (anche fatte) non vengono toccate: l'insert ignora i duplicati.
  const { error: partsError } = await admin.from('transcription_parts').upsert(
    buildTranscriptionParts(duration).map((part) => ({
      transcription_id: transcriptionId!,
      position: part.position,
      start_seconds: part.startSeconds,
      end_seconds: part.endSeconds,
    })),
    { onConflict: 'transcription_id,position', ignoreDuplicates: true }
  )
  if (partsError) throw new AppError('Impossibile preparare le parti', 'unknown', 500, { cause: partsError.message })

  const active = await findActiveJob(admin, video.id)
  if (active) {
    return { jobId: active.id, transcriptionStatus: 'running', shouldRun: !isLeaseLive(active), reused: false }
  }

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .insert({
      job_type: TRANSCRIPTION_JOB_TYPE,
      status: 'pending',
      priority: 3,
      payload: {
        videoId: video.id,
        transcriptionId,
        requestedByUserId: params.userId,
        credentialOwnerUserId: params.userId,
      },
      created_by_user_id: params.userId,
    })
    .select('id')
    .single()
  if (jobError?.code === '23505') {
    const raced = await findActiveJob(admin, video.id)
    if (raced) return { jobId: raced.id, transcriptionStatus: 'running', shouldRun: !isLeaseLive(raced), reused: false }
  }
  if (jobError || !job) throw new AppError('Impossibile accodare la trascrizione', 'unknown', 500, { cause: jobError?.message })
  return { jobId: job.id, transcriptionStatus: 'pending', shouldRun: true, reused: false }
}

/** Legge tutte le frasi (a pagine da 1000 righe, limite PostgREST) in ordine di posizione. */
async function loadAllPhrases(supabase: AppSupabaseClient, transcriptionId: string) {
  const rows: Array<{ position: number; start_seconds: number; text: string; doubtful_time: boolean }> = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('transcription_phrases')
      .select('position, start_seconds, text, doubtful_time')
      .eq('transcription_id', transcriptionId)
      .order('position', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new AppError('Impossibile leggere le frasi', 'unknown', 500, { cause: error.message })
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE_SIZE) return rows
  }
}

/** Stato e frasi della trascrizione per un video già autorizzato (pagina video e GET di stato). */
export async function getTranscriptionViewModel(params: {
  supabase: AppSupabaseClient
  userId: string
  video: Pick<FollowedVideo, 'id' | 'youtube_video_id' | 'video_url'>
  admin?: AdminClient
}): Promise<TranscriptionViewModel> {
  const { supabase, video } = params
  const youtubeVideoId = extractYouTubeVideoId(video.youtube_video_id) ?? extractYouTubeVideoId(video.video_url) ?? video.youtube_video_id

  const { data: transcription, error } = await supabase
    .from('transcriptions')
    .select('id, status, language_code, doubtful_phrase_count, missing_part_count')
    .eq('video_id', video.id)
    .maybeSingle()
  if (error) throw new AppError('Impossibile leggere la trascrizione', 'unknown', 500, { cause: error.message })

  const isRunning = transcription?.status === 'pending' || transcription?.status === 'running'
  const isReadable = transcription?.status === 'complete' || transcription?.status === 'needs_review'

  const [hasGeminiKey, partsResult, phrases, needsResume] = await Promise.all([
    hasUsableGeminiKey(supabase, params.userId),
    transcription
      ? supabase.from('transcription_parts').select('status').eq('transcription_id', transcription.id)
      : Promise.resolve({ data: [], error: null }),
    transcription && isReadable ? loadAllPhrases(supabase, transcription.id) : Promise.resolve([]),
    isRunning
      ? findActiveJob(params.admin ?? createAdminClient(), video.id).then((job) => !job || !isLeaseLive(job))
      : Promise.resolve(false),
  ])
  if (partsResult.error) throw new AppError('Impossibile leggere le parti', 'unknown', 500, { cause: partsResult.error.message })

  return toTranscriptionViewModel({
    videoId: video.id,
    youtubeVideoId,
    transcription,
    partStatuses: (partsResult.data ?? []).map((part) => part.status),
    phrases,
    hasGeminiKey,
    needsResume,
  })
}

/** Esegue un job con le dipendenze di produzione (store Supabase, continuazione via route interna). */
export function runTranscriptionJobNow(
  jobId: string,
  overrides: Partial<TranscriptionWorkerDeps> = {}
): Promise<TranscriptionRunResult> {
  return runTranscriptionJob(jobId, {
    store: createSupabaseTranscriptionStore(),
    requestContinuation: requestTranscriptionContinuation,
    ...overrides,
  })
}

/** Canale del job se è automatico (chiave in rotazione fra i follower), altrimenti null. */
export function autoJobChannelId(payload: unknown): string | null {
  const parsed = parseTranscriptionJobPayload(payload)
  return parsed && parsed.credentialOwnerUserId === null ? parsed.channelId : null
}

/** Vero se il canale ha almeno una chiave Gemini eleggibile (follower attivo, chiave valida). */
export async function hasEligibleChannelCredential(admin: AdminClient, channelId: string): Promise<boolean> {
  const { data, error } = await admin.rpc('has_eligible_transcription_credential', { p_channel_id: channelId })
  if (error) throw new AppError('Impossibile verificare le chiavi del canale', 'unknown', 500, { cause: error.message })
  return data === true
}

/**
 * Recupero per il daily-sync: job di trascrizione pending o con lease scaduta. I job automatici senza chiave eleggibile
 * restano in attesa senza essere reclamati. Con `inline` il primo è ripreso in linea con un budget ridotto; gli altri
 * (o tutti, senza `inline`) ricevono una richiesta di continuazione (best effort).
 */
export async function recoverTranscriptionJobs(
  limit = 5,
  options: { inline?: boolean } = {}
): Promise<{ found: number; resumedInline: number; continued: number }> {
  const inline = options.inline ?? true
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from('jobs')
    .select('id, payload')
    .eq('job_type', TRANSCRIPTION_JOB_TYPE)
    .or(`status.eq.pending,and(status.eq.running,lease_expires_at.lt.${nowIso})`)
    .order('created_at', { ascending: true })
    .limit(limit * RECOVERY_SCAN_FACTOR)
  if (error) throw new AppError('Impossibile leggere i job di trascrizione', 'unknown', 500, { cause: error.message })

  // Un solo controllo chiavi per canale; i job in attesa non occupano il budget del recupero.
  const eligibleByChannel = new Map<string, boolean>()
  const jobs: Array<{ id: string }> = []
  for (const job of data ?? []) {
    const channelId = autoJobChannelId(job.payload)
    if (channelId) {
      if (!eligibleByChannel.has(channelId)) eligibleByChannel.set(channelId, await hasEligibleChannelCredential(admin, channelId))
      if (!eligibleByChannel.get(channelId)) continue
    }
    jobs.push({ id: job.id })
    if (jobs.length >= limit) break
  }

  let resumedInline = 0
  let continued = 0
  for (const [index, job] of jobs.entries()) {
    if (inline && index === 0) {
      await runTranscriptionJobNow(job.id, { softBudgetMs: 80_000, hardBudgetMs: 120_000 })
      resumedInline += 1
    } else {
      await requestTranscriptionContinuation(job.id).then(() => { continued += 1 }, () => undefined)
    }
  }
  return { found: jobs.length, resumedInline, continued }
}
