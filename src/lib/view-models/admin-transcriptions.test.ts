import { describe, expect, it } from 'vitest'
import {
  formatPartInterval,
  sanitizePartError,
  toAdminTranscriptionViewModel,
  toReviewWindowStats,
  type AdminTranscriptionRowInput,
} from '@/lib/view-models/admin-transcriptions'

const row: AdminTranscriptionRowInput = {
  id: 't1',
  status: 'needs_review',
  model: 'gemini-3.1-flash-lite',
  thinking_level: 'minimal',
  language_code: 'it',
  doubtful_phrase_count: 4,
  missing_part_count: 2,
  completed_at: '2026-10-18T10:00:00Z',
  updated_at: '2026-10-18T11:00:00Z',
  videos: { id: 'v1', title: 'Titolo sintetico', youtube_video_id: 'abc123', channels: { title: 'Canale' } },
  transcription_phrases: [{ count: 88 }],
  transcription_parts: [
    { position: 31, start_seconds: 3720, end_seconds: 3840, last_error: 'timeout' },
    { position: 1, start_seconds: 120, end_seconds: 240, last_error: 'secret key=AIza... leaked' },
  ],
}

describe('view model admin trascrizioni', () => {
  it('formatta intervalli m:ss–m:ss e h:mm:ss oltre l ora', () => {
    expect(formatPartInterval(120, 240)).toBe('2:00–4:00')
    expect(formatPartInterval(3720, 3840)).toBe('1:02:00–1:04:00')
  })

  it('sanifica l ultimo errore: solo codici stabili, mai testo libero', () => {
    expect(sanitizePartError('provider_http_503')).toBe('provider_http_503')
    expect(sanitizePartError('secret key=AIza... leaked')).toBe('unknown')
    expect(sanitizePartError(null)).toBeNull()
  })

  it('costruisce righe con link, frasi, parti ordinate e data di completamento', () => {
    const view = toAdminTranscriptionViewModel(row)

    expect(view).toMatchObject({
      id: 't1', status: 'needs_review', videoTitle: 'Titolo sintetico', channelTitle: 'Canale',
      appVideoHref: '/video/v1', youtubeUrl: 'https://www.youtube.com/watch?v=abc123&t=0s',
      phraseCount: 88, doubtfulPhraseCount: 4, referenceDate: '2026-10-18T10:00:00Z', canRelaunch: true,
    })
    expect(view.missingParts).toEqual([
      { position: 1, interval: '2:00–4:00', lastError: 'unknown' },
      { position: 31, interval: '1:02:00–1:04:00', lastError: 'timeout' },
    ])
  })

  it('senza parti mancanti non offre il rilancio e usa la data di aggiornamento', () => {
    const view = toAdminTranscriptionViewModel({ ...row, completed_at: null, transcription_parts: [], transcription_phrases: [] })

    expect(view.canRelaunch).toBe(false)
    expect(view.phraseCount).toBe(0)
    expect(view.referenceDate).toBe('2026-10-18T11:00:00Z')
  })

  it('calcola percentuale da rivedere e media frasi dubbie sulle concluse', () => {
    const stats = toReviewWindowStats(7, [
      { status: 'needs_review', total: 1, doubtful_phrases: 6 },
      { status: 'complete', total: 3, doubtful_phrases: 0 },
      { status: 'running', total: 2, doubtful_phrases: 0 },
    ])

    expect(stats).toMatchObject({ days: 7, finished: 4, needsReviewPercent: 25, averageDoubtfulPhrases: 1.5 })
    expect(stats.counts).toEqual({ pending: 0, running: 2, complete: 3, needs_review: 1, unavailable: 0 })
  })

  it('senza trascrizioni concluse non inventa percentuali', () => {
    expect(toReviewWindowStats(30, [])).toMatchObject({ finished: 0, needsReviewPercent: null, averageDoubtfulPhrases: null })
  })
})
