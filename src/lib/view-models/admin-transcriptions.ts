/* Commento didattico:
 * Scopo del file: view model serializzabile della pagina admin "Trascrizioni" (elenco, parti mancanti, frequenza).
 * Moduli richiamati: helper dei tempi di trascrizione.
 * Flusso: il servizio passa righe già lette; qui si costruiscono link, intervalli `m:ss–m:ss`, errori sanificati e percentuali.
 */

import { buildYoutubeTimeUrl, formatTranscriptTimestamp } from '@/lib/utils/transcript-time'

export type AdminTranscriptionStatus = 'pending' | 'running' | 'complete' | 'needs_review' | 'unavailable'
export const ADMIN_TRANSCRIPTION_STATUSES: readonly AdminTranscriptionStatus[] = [
  'needs_review', 'pending', 'running', 'complete', 'unavailable',
]

export interface AdminTranscriptionRowInput {
  id: string
  status: AdminTranscriptionStatus
  model: string
  thinking_level: string
  language_code: string | null
  doubtful_phrase_count: number
  missing_part_count: number
  completed_at: string | null
  updated_at: string
  videos: {
    id: string
    title: string
    youtube_video_id: string
    channels: { title: string | null } | null
  } | null
  transcription_phrases: Array<{ count: number }> | null
  transcription_parts: Array<{
    position: number
    start_seconds: number
    end_seconds: number
    last_error: string | null
  }> | null
}

export interface AdminMissingPartViewModel {
  position: number
  interval: string
  lastError: string | null
}

export interface AdminTranscriptionViewModel {
  id: string
  status: AdminTranscriptionStatus
  videoTitle: string
  channelTitle: string | null
  appVideoHref: string | null
  youtubeUrl: string | null
  model: string
  thinkingLevel: string
  phraseCount: number
  doubtfulPhraseCount: number
  missingParts: AdminMissingPartViewModel[]
  referenceDate: string
  canRelaunch: boolean
}

export interface AdminReviewWindowStats {
  days: number
  counts: Record<AdminTranscriptionStatus, number>
  finished: number
  needsReviewPercent: number | null
  averageDoubtfulPhrases: number | null
}

/** Codice d'errore stabile (solo minuscole, cifre e underscore); qualsiasi altro testo non viene mai mostrato. */
export function sanitizePartError(value: string | null): string | null {
  if (!value) return null
  return /^[a-z0-9_]{1,60}$/.test(value) ? value : 'unknown'
}

/** Intervallo `m:ss–m:ss` di una parte. */
export function formatPartInterval(startSeconds: number, endSeconds: number): string {
  return `${formatTranscriptTimestamp(startSeconds)}–${formatTranscriptTimestamp(endSeconds)}`
}

export function toAdminTranscriptionViewModel(row: AdminTranscriptionRowInput): AdminTranscriptionViewModel {
  const missingParts = [...(row.transcription_parts ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((part) => ({
      position: part.position,
      interval: formatPartInterval(part.start_seconds, part.end_seconds),
      lastError: sanitizePartError(part.last_error),
    }))
  return {
    id: row.id,
    status: row.status,
    videoTitle: row.videos?.title ?? '',
    channelTitle: row.videos?.channels?.title ?? null,
    appVideoHref: row.videos ? `/video/${row.videos.id}` : null,
    youtubeUrl: row.videos ? buildYoutubeTimeUrl(row.videos.youtube_video_id, 0) : null,
    model: row.model,
    thinkingLevel: row.thinking_level,
    phraseCount: row.transcription_phrases?.[0]?.count ?? 0,
    doubtfulPhraseCount: row.doubtful_phrase_count,
    missingParts,
    referenceDate: row.completed_at ?? row.updated_at,
    canRelaunch: missingParts.length > 0,
  }
}

/** Conteggi per stato e frequenza: percentuale "da rivedere" sulle trascrizioni concluse della finestra. */
export function toReviewWindowStats(
  days: number,
  rows: Array<{ status: string; total: number; doubtful_phrases: number }>
): AdminReviewWindowStats {
  const counts: Record<AdminTranscriptionStatus, number> = {
    pending: 0, running: 0, complete: 0, needs_review: 0, unavailable: 0,
  }
  let finishedDoubtful = 0
  for (const row of rows) {
    if (!(row.status in counts)) continue
    counts[row.status as AdminTranscriptionStatus] = Number(row.total)
    if (row.status === 'complete' || row.status === 'needs_review') finishedDoubtful += Number(row.doubtful_phrases)
  }
  const finished = counts.complete + counts.needs_review
  return {
    days,
    counts,
    finished,
    needsReviewPercent: finished > 0 ? Math.round((counts.needs_review / finished) * 1000) / 10 : null,
    averageDoubtfulPhrases: finished > 0 ? Math.round((finishedDoubtful / finished) * 10) / 10 : null,
  }
}
