/* Commento didattico:
 * Scopo del file: view model serializzabile della trascrizione di un video per pagina e API di stato.
 * Moduli richiamati: helper dei tempi di trascrizione.
 * Flusso: il servizio passa righe minime già lette; qui si calcolano stato visibile, etichette e link al minuto.
 */

import { buildYoutubeTimeUrl, formatTranscriptTimestamp } from '@/lib/utils/transcript-time'

export type TranscriptionViewState = 'absent' | 'running' | 'complete' | 'needs_review' | 'unavailable'
export type TranscriptionRequestBlockedReason = 'gemini_key_missing' | null

export interface TranscriptionPhraseViewModel {
  position: number
  startSeconds: number
  timeLabel: string
  text: string
  isTimeDoubtful: boolean
  youtubeUrl: string
}

export interface TranscriptionViewModel {
  videoId: string
  state: TranscriptionViewState
  languageCode: string | null
  phrases: TranscriptionPhraseViewModel[]
  doubtfulPhraseCount: number
  missingPartCount: number
  progress: { doneParts: number; totalParts: number } | null
  /** Vero se un job attivo è fermo (nessuna lease valida) e una nuova richiesta lo riprende. */
  needsResume: boolean
  canRequest: boolean
  requestBlockedReason: TranscriptionRequestBlockedReason
}

export interface TranscriptionViewInput {
  videoId: string
  youtubeVideoId: string
  transcription: {
    status: 'pending' | 'running' | 'complete' | 'needs_review' | 'unavailable'
    language_code: string | null
    doubtful_phrase_count: number
    missing_part_count: number
  } | null
  partStatuses: Array<'pending' | 'done' | 'missing'>
  phrases: Array<{ position: number; start_seconds: number; text: string; doubtful_time: boolean }>
  hasGeminiKey: boolean
  needsResume: boolean
}

/** Costruisce il view model; senza trascrizione lo stato è `absent` e il pulsante dipende dalla chiave Gemini. */
export function toTranscriptionViewModel(input: TranscriptionViewInput): TranscriptionViewModel {
  const { transcription } = input
  const state: TranscriptionViewState = !transcription
    ? 'absent'
    : transcription.status === 'pending' || transcription.status === 'running'
      ? 'running'
      : transcription.status
  const readable = state === 'complete' || state === 'needs_review'
  const doneParts = input.partStatuses.filter((status) => status === 'done').length
  return {
    videoId: input.videoId,
    state,
    languageCode: transcription?.language_code ?? null,
    phrases: readable
      ? input.phrases.map((phrase) => ({
          position: phrase.position,
          startSeconds: phrase.start_seconds,
          timeLabel: formatTranscriptTimestamp(phrase.start_seconds),
          text: phrase.text,
          isTimeDoubtful: phrase.doubtful_time,
          youtubeUrl: buildYoutubeTimeUrl(input.youtubeVideoId, phrase.start_seconds),
        }))
      : [],
    doubtfulPhraseCount: transcription?.doubtful_phrase_count ?? 0,
    missingPartCount: transcription?.missing_part_count ?? 0,
    progress: state === 'running' ? { doneParts, totalParts: input.partStatuses.length } : null,
    needsResume: state === 'running' && input.needsResume,
    canRequest: state === 'absent' && input.hasGeminiKey,
    requestBlockedReason: state === 'absent' && !input.hasGeminiKey ? 'gemini_key_missing' : null,
  }
}
