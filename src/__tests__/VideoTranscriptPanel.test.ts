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
  title: 'Trascrizione', absent: 'Nessuna trascrizione.', waitingForGeminiKey: 'In attesa di una chiave Gemini.',
  running: 'In corso: {done} su {total}.', runningNoProgress: 'In corso.',
  complete: 'Clicca una frase.', needsReview: 'Da rivedere.', unavailable: 'Non disponibile.', request: 'Trascrivi',
  requesting: 'Richiesta…', blockedGeminiKey: 'Serve una chiave Gemini: aggiungila in', integrationsLink: 'Integrazioni',
  doubtfulTime: 'Tempo da verificare', openOnYoutube: 'Apri su YouTube a {time}', jumpTo: 'Vai a {time}',
  missingPartsOne: '{count} parte mancante', missingPartsOther: '{count} parti mancanti',
  doubtfulOne: '{count} tempo dubbio', doubtfulOther: '{count} tempi dubbi', requestError: 'Errore', noPhrases: 'Nessun parlato.',
}

function view(overrides: Partial<Parameters<typeof toTranscriptionViewModel>[0]> = {}) {
  return toTranscriptionViewModel({
    videoId: 'v-1', youtubeVideoId: 'abcdefghijk', transcription: null, partStatuses: [], phrases: [], hasGeminiKey: true,
    waitingForGeminiKey: false, needsResume: false,
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

  it('senza chiave Gemini mostra una sola volta l’invito e nasconde il pulsante', () => {
    const markup = renderToStaticMarkup(createElement(VideoTranscriptPanel, {
      videoId: 'v-1', initial: view({ hasGeminiKey: false }), labels,
    }))
    expect(markup).not.toContain('>Trascrivi</button>')
    expect(markup.match(/Serve una chiave Gemini: aggiungila in/g)).toHaveLength(1)
    expect(markup.match(/href="\/integrations"/g)).toHaveLength(1)
    expect(markup).toContain('href="/integrations"')
  })

  it('in attesa di una chiave mostra lo stato dedicato senza avanzamento', () => {
    const markup = renderToStaticMarkup(createElement(VideoTranscriptPanel, {
      videoId: 'v-1',
      initial: view({
        hasGeminiKey: false,
        waitingForGeminiKey: true,
        transcription: { status: 'pending', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 },
        partStatuses: ['pending', 'pending'],
      }),
      labels,
    }))

    expect(markup).toContain('In attesa di una chiave Gemini.')
    expect(markup).not.toContain('In corso')
    expect(markup).not.toContain('0 su 2')
    expect(markup).toContain('href="/integrations"')
  })

  it('con chiave il pulsante è attivo senza avviso; trascrizioni esistenti non mostrano né pulsante né avviso', () => {
    const active = renderToStaticMarkup(createElement(VideoTranscriptPanel, { videoId: 'v-1', initial: view(), labels }))
    expect(active).toContain('>Trascrivi</button>')
    expect(active).not.toContain('disabled=""')
    expect(active).toContain('Nessuna trascrizione.')
    expect(active).not.toContain('Serve una chiave Gemini')

    const existing = renderToStaticMarkup(createElement(VideoTranscriptPanel, { videoId: 'v-1', initial: reviewed, labels }))
    expect(existing).not.toContain('>Trascrivi<')
    expect(existing).not.toContain('Serve una chiave Gemini')

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
