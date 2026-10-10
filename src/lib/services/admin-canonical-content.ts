/* Commento didattico:
 * Scopo: legge contenuti canonici persistiti per la sola console admin.
 * Moduli richiamati: auth admin, client Supabase privilegiato e view model admin.
 * Flusso: verifica sessione, legge righe esistenti e separa i testi dai dati della tabella.
 */

import { getAdminSession } from '@/lib/auth/admin'
import type { ErrorCode } from '@/lib/http/errorCodes'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  toAdminCanonicalContentDetailViewModel,
  toAdminCanonicalVideoViewModel,
  type AdminCanonicalContentDetailViewModel,
  type AdminCanonicalContentKind,
  type AdminCanonicalVideoViewModel,
} from '@/lib/view-models/admin-canonical-content'

export type AdminCanonicalContentResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthorized' }
  | { status: 'not_found' }
  | { status: 'error'; code: ErrorCode; message: string }

/** Costruisce un errore pubblico stabile senza propagare messaggi interni del database. */
function internalError(): { status: 'error'; code: ErrorCode; message: string } {
  return { status: 'error', code: 'INTERNAL_ERROR', message: 'Errore interno' }
}

interface LocalizedContentRow {
  language_code: string
  short_summary: string | null
  full_summary: string | null
  general_category: string | null
  subcategory: string | null
  is_admin_edited: boolean
}

interface VideoListRow {
  id: string
  title: string
  youtube_video_id: string
  published_at: string
  channel: { title: string } | { title: string }[] | null
  localized: LocalizedContentRow[] | null
}

interface TranscriptListRow {
  video_id: string
  language_code: string
  transcript_text: string | null
}

/** Carica la tabella admin solo dopo aver verificato la sessione privilegiata. */
export async function loadAdminCanonicalVideos(): Promise<
  AdminCanonicalContentResult<AdminCanonicalVideoViewModel[]>
> {
  if (!(await getAdminSession())) return { status: 'unauthorized' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      youtube_video_id,
      published_at,
      channel:channels(title),
      localized:video_localized_content(
        language_code,
        short_summary,
        full_summary,
        general_category,
        subcategory,
        is_admin_edited
      )
    `)
    .order('published_at', { ascending: false })
    .limit(100)

  if (error) return internalError()

  const videos = (data ?? []) as unknown as VideoListRow[]
  if (videos.length === 0) return { status: 'ok', data: [] }

  const { data: transcriptData, error: transcriptError } = await supabase
    .from('video_transcripts')
    .select('video_id, language_code, transcript_text')
    .in('video_id', videos.map((video) => video.id))

  if (transcriptError) return internalError()

  const transcriptsByVideo = new Map<string, TranscriptListRow[]>()
  for (const transcript of (transcriptData ?? []) as TranscriptListRow[]) {
    const transcripts = transcriptsByVideo.get(transcript.video_id) ?? []
    transcripts.push(transcript)
    transcriptsByVideo.set(transcript.video_id, transcripts)
  }

  return {
    status: 'ok',
    data: videos.map((video) => {
      const channel = Array.isArray(video.channel) ? video.channel[0] : video.channel
      return toAdminCanonicalVideoViewModel({
        id: video.id,
        title: video.title,
        youtubeVideoId: video.youtube_video_id,
        publishedAt: video.published_at,
        channelTitle: channel?.title ?? null,
        localizedContent: (video.localized ?? []).map((item) => ({
          languageCode: item.language_code,
          shortSummary: item.short_summary,
          fullSummary: item.full_summary,
          generalCategory: item.general_category,
          subcategory: item.subcategory,
          isAdminEdited: item.is_admin_edited,
        })),
        transcripts: (transcriptsByVideo.get(video.id) ?? []).map((item) => ({
          languageCode: item.language_code,
          transcriptText: item.transcript_text,
        })),
      })
    }),
  }
}

export interface AdminCanonicalContentDetailRequest {
  videoId: string
  kind: AdminCanonicalContentKind
  languageCode: string
}

/** Legge un singolo documento salvato per video, sezione e lingua, senza attivare pipeline. */
export async function loadAdminCanonicalContentDetail(
  request: AdminCanonicalContentDetailRequest
): Promise<AdminCanonicalContentResult<AdminCanonicalContentDetailViewModel>> {
  if (!(await getAdminSession())) return { status: 'unauthorized' }

  const supabase = createAdminClient()
  const { data: videoData, error: videoError } = await supabase
    .from('videos')
    .select('id, title')
    .eq('id', request.videoId)
    .maybeSingle()

  if (videoError) return internalError()
  if (!videoData) return { status: 'not_found' }

  if (request.kind === 'transcript') {
    const { data, error } = await supabase
      .from('video_transcripts')
      .select('transcript_text')
      .eq('video_id', request.videoId)
      .eq('language_code', request.languageCode)
      .maybeSingle()

    if (error) return internalError()
    return {
      status: 'ok',
      data: toAdminCanonicalContentDetailViewModel({
        videoId: request.videoId,
        videoTitle: videoData.title,
        languageCode: request.languageCode,
        kind: request.kind,
        transcriptText: data?.transcript_text ?? null,
      }),
    }
  }

  if (request.kind === 'summary') {
    const { data, error } = await supabase
      .from('video_localized_content')
      .select('short_summary, full_summary')
      .eq('video_id', request.videoId)
      .eq('language_code', request.languageCode)
      .maybeSingle()

    if (error) return internalError()
    return {
      status: 'ok',
      data: toAdminCanonicalContentDetailViewModel({
        videoId: request.videoId,
        videoTitle: videoData.title,
        languageCode: request.languageCode,
        kind: request.kind,
        shortSummary: data?.short_summary ?? null,
        fullSummary: data?.full_summary ?? null,
      }),
    }
  }

  const { data, error } = await supabase
    .from('video_localized_content')
    .select('general_category, subcategory')
    .eq('video_id', request.videoId)
    .eq('language_code', request.languageCode)
    .maybeSingle()

  if (error) return internalError()
  return {
    status: 'ok',
    data: toAdminCanonicalContentDetailViewModel({
      videoId: request.videoId,
      videoTitle: videoData.title,
      languageCode: request.languageCode,
      kind: request.kind,
      generalCategory: data?.general_category ?? null,
      subcategory: data?.subcategory ?? null,
    }),
  }
}
