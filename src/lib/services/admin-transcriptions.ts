import type { createAdminClient } from '@/lib/supabase/admin'
import {
  ADMIN_TRANSCRIPTION_STATUSES,
  toAdminTranscriptionViewModel,
  toReviewWindowStats,
  type AdminReviewWindowStats,
  type AdminTranscriptionRowInput,
  type AdminTranscriptionStatus,
  type AdminTranscriptionViewModel,
} from '@/lib/view-models/admin-transcriptions'

type AdminClient = ReturnType<typeof createAdminClient>

export const ADMIN_TRANSCRIPTIONS_PAGE_SIZE = 25
/** Finestre di frequenza (giorni) mostrate dall'indicatore. */
export const ADMIN_REVIEW_WINDOWS = [7, 30] as const
export const ADMIN_DEFAULT_FILTER = 'needs_review'

export type AdminTranscriptionFilter = AdminTranscriptionStatus | 'all'
export const ADMIN_TRANSCRIPTION_FILTERS: readonly AdminTranscriptionFilter[] = [...ADMIN_TRANSCRIPTION_STATUSES, 'all']

export interface AdminTranscriptionList {
  filter: AdminTranscriptionFilter
  page: number
  pageCount: number
  total: number
  items: AdminTranscriptionViewModel[]
}

const LIST_SELECT = `id, status, model, thinking_level, language_code, doubtful_phrase_count, missing_part_count, completed_at, updated_at,
  videos!inner(id, title, youtube_video_id, channels(title)),
  transcription_phrases(count),
  transcription_parts(position, start_seconds, end_seconds, last_error)`

/** Elenco paginato, dal più recente: le parti incluse sono solo quelle mancanti. */
export async function listAdminTranscriptions(
  admin: AdminClient,
  params: { filter: AdminTranscriptionFilter; page: number }
): Promise<AdminTranscriptionList> {
  const from = (params.page - 1) * ADMIN_TRANSCRIPTIONS_PAGE_SIZE
  let query = admin
    .from('transcriptions')
    .select(LIST_SELECT, { count: 'exact' })
    .eq('transcription_parts.status', 'missing')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .order('position', { ascending: true, referencedTable: 'transcription_parts' })
    .range(from, from + ADMIN_TRANSCRIPTIONS_PAGE_SIZE - 1)
  if (params.filter !== 'all') query = query.eq('status', params.filter)

  const { data, error, count } = await query
  if (error) throw new Error('Impossibile leggere le trascrizioni')
  const total = count ?? 0
  return {
    filter: params.filter,
    page: params.page,
    pageCount: Math.max(1, Math.ceil(total / ADMIN_TRANSCRIPTIONS_PAGE_SIZE)),
    total,
    items: ((data ?? []) as unknown as AdminTranscriptionRowInput[]).map(toAdminTranscriptionViewModel),
  }
}

/** Frequenza per finestra: data di riferimento = completamento (aggiornamento se non ancora conclusa). */
export async function getAdminReviewStats(admin: AdminClient): Promise<AdminReviewWindowStats[]> {
  return Promise.all(ADMIN_REVIEW_WINDOWS.map(async (days) => {
    const { data, error } = await admin.rpc('transcription_review_stats', { p_days: days })
    if (error) throw new Error('Impossibile leggere le statistiche delle trascrizioni')
    return toReviewWindowStats(days, data ?? [])
  }))
}

export type RelaunchResult =
  | { status: 'relaunched'; jobId: string; partsReset: number; credentialMode: 'requester' | 'channel_rotation' }
  | { status: 'not_found' }
  | { status: 'no_missing' }
  | { status: 'busy' }

/** Rilancio atomico (RPC solo service_role): parti mancanti → pending, chiavi esaurite svuotate, job unico, audit. */
export async function relaunchMissingParts(
  admin: AdminClient,
  input: { transcriptionId: string; partPosition: number | null; adminUsername: string }
): Promise<RelaunchResult> {
  const { data, error } = await admin.rpc('relaunch_missing_transcription_parts', {
    p_transcription_id: input.transcriptionId,
    p_part_position: input.partPosition,
    p_admin_username: input.adminUsername,
  })
  if (error) throw new Error('Impossibile rilanciare le parti mancanti')
  const row = data?.[0]
  if (!row) throw new Error('Esito del rilancio non valido')
  if (row.status === 'relaunched' && row.job_id && row.credential_mode) {
    return { status: 'relaunched', jobId: row.job_id, partsReset: row.parts_reset, credentialMode: row.credential_mode }
  }
  if (row.status === 'not_found' || row.status === 'no_missing' || row.status === 'busy') return { status: row.status }
  throw new Error('Esito del rilancio non valido')
}
