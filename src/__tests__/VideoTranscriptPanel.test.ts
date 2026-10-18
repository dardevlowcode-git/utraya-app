/* Commento didattico:
 * Scopo del file: verifica la pagina video lato trascrizione: elenco frasi, link `&t=`, tempo dubbio, pulsante disattivato, salto nel lettore.
 * Moduli richiamati: `VideoTranscriptPanel`, `VideoEmbedPlayer`, React SSR/hydration, view model sintetico.
 * Flusso: renderizza ogni stato visibile e simula il clic su una frase controllando il comando postMessage.
 */

// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHydrated } from './client-render'
import VideoEmbedPlayer from '../app/(private)/video/[videoId]/VideoEmbedPlayer'
import VideoTranscriptPanel, { type VideoTranscriptLabels } from '@/components/video/VideoTranscriptPanel'
import { toTranscriptionViewModel } from '@/lib/view-models/transcription'
import { buildPlayCommand, buildSeekCommand } from '@/lib/utils/youtube-embed-control'

const labels: VideoTranscriptLabels = {
  title: 'Trascrizione', absent: 'Nessuna trascrizione.', running: 'In corso: {done} su {total}.', runningNoProgress: 'In corso.',
  complete: 'Clicca una frase.', needsReview: 'Da rivedere.', unavailable: 'Non disponibile.', request: 'Trascrivi',
  requesting: 'Richiesta…', blockedGeminiKey: 'Serve una chiave Gemini: aggiungila in', integrationsLink: 'Integrazioni',
  doubtfulTime: 'Tempo da verificare', openOnYoutube: 'Apri su YouTube a {time}', jumpTo: 'Vai a {time}',
  missingPartsOne: '{count} parte mancante', missingPartsOther: '{count} parti mancanti',
  doubtfulOne: '{count} tempo dubbio', doubtfulOther: '{count} tempi dubbi', requestError: 'Errore', noPhrases: 'Nessun parlato.',
}

function view(overrides: Partial<Parameters<typeof toTranscriptionViewModel>[0]> = {}) {
  return toTranscriptionViewModel({
    videoId: 'v-1', youtubeVideoId: 'abcdefghijk', transcription: null, partStatuses: [], phrases: [], hasGeminiKey: true, needsResume: false,
    ...overrides,
  })
}

const reviewed = view({
  transcription: { status: 'needs_review', language_code: 'it', doubtful_phrase_count: 1, missing_part_count: 2 },
  phrases: [
    { position: 0, start_seconds: 65, text: 'frase sintetica uno', doubtful_time: false },
    { position: 1, start_seconds: 130, text: 'frase sintetica due', doubtful_time: true },
  ],
})

afterEach(() => vi.restoreAllMocks())

describe('VideoTranscriptPanel', () => {
  it('mostra frasi con minuto, link al secondo su YouTube e marca discreta del tempo dubbio', () => {
    const markup = renderToStaticMarkup(createElement(VideoTranscriptPanel, { videoId: 'v-1', initial: reviewed, labels }))
    expect(markup).toContain('1:05')
    expect(markup).toContain('2:10')
    expect(markup).toContain('frase sintetica uno')
    expect(markup).toContain('href="https://www.youtube.com/watch?v=abcdefghijk&amp;t=65s"')
    expect(markup).toContain('href="https://www.youtube.com/watch?v=abcdefghijk&amp;t=130s"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('title="Tempo da verificare"')
    expect(markup.match(/title="Tempo da verificare"/g)).toHaveLength(1)
    expect(markup).toContain('1 tempo dubbio · 2 parti mancanti')
    expect(markup).toContain('Da rivedere.')
    expect(markup).not.toContain('Trascrivi</button>')
  })

  it('senza chiave Gemini il pulsante è disattivato e il motivo è visibile', () => {
    const markup = renderToStaticMarkup(createElement(VideoTranscriptPanel, {
      videoId: 'v-1', initial: view({ hasGeminiKey: false }), labels,
    }))
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Trascrivi<\/button>/)
    expect(markup).toContain('Serve una chiave Gemini: aggiungila in')
    expect(markup).toContain('href="/integrations"')
  })

  it('con chiave il pulsante è attivo; in corso mostra l’avanzamento; non disponibile il suo stato', () => {
    const active = renderToStaticMarkup(createElement(VideoTranscriptPanel, { videoId: 'v-1', initial: view(), labels }))
    expect(active).toContain('>Trascrivi</button>')
    expect(active).not.toContain('disabled=""')
    expect(active).toContain('Nessuna trascrizione.')

    const running = renderToStaticMarkup(createElement(VideoTranscriptPanel, {
      videoId: 'v-1',
      initial: view({
        transcription: { status: 'running', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 },
        partStatuses: ['done', 'pending', 'pending'],
      }),
      labels,
    }))
    expect(running).toContain('In corso: 1 su 3.')
    expect(running).not.toContain('>Trascrivi<')

    const unavailable = renderToStaticMarkup(createElement(VideoTranscriptPanel, {
      videoId: 'v-1',
      initial: view({ transcription: { status: 'unavailable', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 } }),
      labels,
    }))
    expect(unavailable).toContain('Non disponibile.')
  })

  it('il clic su una frase sposta il lettore incorporato a quel secondo e lo avvia', async () => {
    // L'iframe resta nel documento (serve getElementById) ma non deve aprire rete reale.
    const happyDom = (window as unknown as { happyDOM?: { settings: { disableIframePageLoading: boolean } } }).happyDOM
    if (happyDom) happyDom.settings.disableIframePageLoading = true
    const mounted = await renderHydrated(createElement('div', null,
      createElement(VideoEmbedPlayer, { youtubeVideoId: 'abcdefghijk', title: 'Video' }),
      createElement(VideoTranscriptPanel, { videoId: 'v-1', initial: reviewed, labels })
    ))
    try {
      const frame = mounted.container.querySelector('iframe') as HTMLIFrameElement
      expect(frame.id).toBe('utraya-video-player')
      expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk?enablejsapi=1')
      const postMessage = vi.fn()
      Object.defineProperty(frame, 'contentWindow', { value: { postMessage }, configurable: true })
      frame.scrollIntoView = vi.fn()

      const jump = mounted.container.querySelector('button[aria-label="Vai a 2:10"]') as HTMLButtonElement
      await act(async () => { jump.click() })

      expect(postMessage).toHaveBeenNthCalledWith(1, buildSeekCommand(130), 'https://www.youtube-nocookie.com')
      expect(postMessage).toHaveBeenNthCalledWith(2, buildPlayCommand(), 'https://www.youtube-nocookie.com')
    } finally {
      await mounted.unmount()
    }
  })
})
