/* Commento didattico:
 * Scopo del file: verifica i comandi postMessage verso il lettore YouTube incorporato.
 * Moduli richiamati: `vitest`, `./youtube-embed-control`.
 * Flusso: controlla il formato dei messaggi, l'origine di destinazione e il comportamento senza iframe.
 */

import { describe, expect, it, vi } from 'vitest'
import { buildPlayCommand, buildSeekCommand, seekEmbeddedPlayer } from './youtube-embed-control'

describe('youtube embed control', () => {
  it('costruisce i comandi seekTo e playVideo senza script IFrame API', () => {
    expect(JSON.parse(buildSeekCommand(125.9))).toEqual({ event: 'command', func: 'seekTo', args: [125, true] })
    expect(JSON.parse(buildPlayCommand())).toEqual({ event: 'command', func: 'playVideo', args: [] })
  })

  it('invia seek e play all’origine dell’iframe', () => {
    const postMessage = vi.fn()
    const frame = { src: 'https://www.youtube-nocookie.com/embed/abc?enablejsapi=1', contentWindow: { postMessage } } as unknown as HTMLIFrameElement
    expect(seekEmbeddedPlayer(frame, 42)).toBe(true)
    expect(postMessage).toHaveBeenNthCalledWith(1, buildSeekCommand(42), 'https://www.youtube-nocookie.com')
    expect(postMessage).toHaveBeenNthCalledWith(2, buildPlayCommand(), 'https://www.youtube-nocookie.com')
  })

  it('restituisce false se l’iframe non c’è', () => {
    expect(seekEmbeddedPlayer(null, 10)).toBe(false)
    expect(seekEmbeddedPlayer({ src: 'x', contentWindow: null } as unknown as HTMLIFrameElement, 10)).toBe(false)
  })
})
