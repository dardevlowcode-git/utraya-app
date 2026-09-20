/* Commento didattico:
 * Scopo del file: testare l'estrazione robusta di YouTube video id da input eterogenei.
 * Moduli richiamati: `vitest`, `@/lib/utils/youtube-video-id`.
 * Flusso: copre id nudi, URL watch/embed/short e input invalidi.
 */

import { describe, expect, it } from 'vitest'
import { extractYouTubeVideoId } from '@/lib/utils/youtube-video-id'

describe('extractYouTubeVideoId', () => {
  const sampleId = 'dQw4w9WgXcQ'

  it('accetta direttamente un id valido', () => {
    expect(extractYouTubeVideoId(sampleId)).toBe(sampleId)
  })

  it('estrae id da URL watch standard', () => {
    expect(extractYouTubeVideoId(`https://www.youtube.com/watch?v=${sampleId}`)).toBe(sampleId)
  })

  it('estrae id da URL youtu.be e embed', () => {
    expect(extractYouTubeVideoId(`https://youtu.be/${sampleId}`)).toBe(sampleId)
    expect(extractYouTubeVideoId(`https://www.youtube.com/embed/${sampleId}`)).toBe(sampleId)
  })

  it('ritorna null su input non validi', () => {
    expect(extractYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(extractYouTubeVideoId('not-an-url')).toBeNull()
    expect(extractYouTubeVideoId(null)).toBeNull()
  })
})
