/* Commento didattico:
 * Scopo del file: verifica parser/formatter/bucket della durata video.
 * Moduli richiamati: `vitest`, `@/lib/utils/video-duration`.
 * Flusso: test unitari su casi validi, invalidi e boundary.
 */

import { describe, expect, it } from 'vitest'
import { formatVideoDuration, getVideoDurationBucket, parseYouTubeDurationToSeconds } from '@/lib/utils/video-duration'

describe('video-duration utils', () => {
  it('parsa durate ISO-8601 valide', () => {
    expect(parseYouTubeDurationToSeconds('PT59S')).toBe(59)
    expect(parseYouTubeDurationToSeconds('PT2M')).toBe(120)
    expect(parseYouTubeDurationToSeconds('PT1H3M5S')).toBe(3785)
  })

  it('ritorna null su durate non valide', () => {
    expect(parseYouTubeDurationToSeconds('P1DT2H')).toBeNull()
    expect(parseYouTubeDurationToSeconds('')).toBeNull()
    expect(parseYouTubeDurationToSeconds(null)).toBeNull()
  })

  it('classifica bucket durata correttamente', () => {
    expect(getVideoDurationBucket(119)).toBe('under_2m')
    expect(getVideoDurationBucket(120)).toBe('between_2m_30m')
    expect(getVideoDurationBucket(1800)).toBe('between_2m_30m')
    expect(getVideoDurationBucket(1801)).toBe('over_30m')
    expect(getVideoDurationBucket(null)).toBe('unknown')
  })

  it('formatta la durata in stringa leggibile', () => {
    expect(formatVideoDuration(59)).toBe('0:59')
    expect(formatVideoDuration(120)).toBe('2:00')
    expect(formatVideoDuration(3785)).toBe('1:03:05')
    expect(formatVideoDuration(null)).toBeNull()
  })
})
