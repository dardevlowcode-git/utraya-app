import { describe, expect, it } from 'vitest'
import { buildYoutubeTimeUrl, formatTranscriptTimestamp, parseTranscriptTimestamp } from './transcript-time'

describe('transcript time helpers', () => {
  it('legge MM:SS, H:MM:SS e minuti oltre 59', () => {
    expect(parseTranscriptTimestamp('00:07')).toBe(7)
    expect(parseTranscriptTimestamp('5:05')).toBe(305)
    expect(parseTranscriptTimestamp('75:30')).toBe(4530)
    expect(parseTranscriptTimestamp('1:15:30')).toBe(4530)
    expect(parseTranscriptTimestamp(12.9)).toBe(12)
  })

  it('rifiuta formati non riconosciuti', () => {
    for (const value of ['', 'abc', '12', '1:99', '-1:00', null, undefined, {}, Number.NaN, -3]) {
      expect(parseTranscriptTimestamp(value)).toBeNull()
    }
  })

  it('formatta m:ss e h:mm:ss', () => {
    expect(formatTranscriptTimestamp(0)).toBe('0:00')
    expect(formatTranscriptTimestamp(65)).toBe('1:05')
    expect(formatTranscriptTimestamp(3725)).toBe('1:02:05')
  })

  it('costruisce il link al minuto', () => {
    expect(buildYoutubeTimeUrl('abcdefghijk', 125)).toBe('https://www.youtube.com/watch?v=abcdefghijk&t=125s')
  })
})
