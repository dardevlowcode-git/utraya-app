import { describe, expect, it } from 'vitest'
import { toTranscriptionViewModel, type TranscriptionViewInput } from './transcription'

const base: TranscriptionViewInput = {
  videoId: 'v-1',
  youtubeVideoId: 'abcdefghijk',
  transcription: null,
  partStatuses: [],
  phrases: [],
  hasGeminiKey: true,
  waitingForGeminiKey: false,
  needsResume: false,
}

describe('toTranscriptionViewModel', () => {
  it('assente: pulsante attivo con chiave, disattivato con motivo senza', () => {
    expect(toTranscriptionViewModel(base)).toMatchObject({ state: 'absent', canRequest: true, requestBlockedReason: null })
    expect(toTranscriptionViewModel({ ...base, hasGeminiKey: false }))
      .toMatchObject({ state: 'absent', canRequest: false, requestBlockedReason: 'gemini_key_missing' })
  })

  it('in corso: pending e running diventano running con avanzamento, senza frasi', () => {
    const view = toTranscriptionViewModel({
      ...base,
      transcription: { status: 'pending', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 },
      partStatuses: ['done', 'pending', 'pending'],
      phrases: [{ position: 0, start_seconds: 1, text: 'x', doubtful_time: false }],
      needsResume: true,
    })
    expect(view).toMatchObject({ state: 'running', progress: { doneParts: 1, totalParts: 3 }, needsResume: true, phrases: [], canRequest: false })
  })

  it('pending in attesa di una chiave non mostra avanzamento e suggerisce Integrazioni se manca la chiave personale', () => {
    const view = toTranscriptionViewModel({
      ...base,
      hasGeminiKey: false,
      waitingForGeminiKey: true,
      transcription: { status: 'pending', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 },
      partStatuses: ['pending', 'pending'],
    })

    expect(view).toMatchObject({
      state: 'waiting_for_key',
      progress: null,
      needsResume: false,
      canRequest: false,
      requestBlockedReason: 'gemini_key_missing',
    })
  })

  it('pending con chiave eleggibile resta in corso e complete resta invariato', () => {
    const pending = toTranscriptionViewModel({
      ...base,
      waitingForGeminiKey: false,
      transcription: { status: 'pending', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 },
    })
    const complete = toTranscriptionViewModel({
      ...base,
      waitingForGeminiKey: true,
      transcription: { status: 'complete', language_code: 'it', doubtful_phrase_count: 0, missing_part_count: 0 },
    })

    expect(pending.state).toBe('running')
    expect(complete.state).toBe('complete')
  })

  it('completa o da rivedere: frasi con minuto, link e tempo dubbio', () => {
    const view = toTranscriptionViewModel({
      ...base,
      transcription: { status: 'needs_review', language_code: 'it', doubtful_phrase_count: 1, missing_part_count: 2 },
      phrases: [
        { position: 0, start_seconds: 65, text: 'prima', doubtful_time: false },
        { position: 1, start_seconds: 3725, text: 'seconda', doubtful_time: true },
      ],
    })
    expect(view.state).toBe('needs_review')
    expect(view.progress).toBeNull()
    expect(view.phrases).toEqual([
      { position: 0, startSeconds: 65, timeLabel: '1:05', text: 'prima', isTimeDoubtful: false, youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk&t=65s' },
      { position: 1, startSeconds: 3725, timeLabel: '1:02:05', text: 'seconda', isTimeDoubtful: true, youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk&t=3725s' },
    ])
    expect(view).toMatchObject({ languageCode: 'it', doubtfulPhraseCount: 1, missingPartCount: 2, needsResume: false })
  })

  it('non disponibile non offre il pulsante', () => {
    expect(toTranscriptionViewModel({
      ...base,
      transcription: { status: 'unavailable', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 },
    })).toMatchObject({ state: 'unavailable', canRequest: false, requestBlockedReason: null })
  })
})
