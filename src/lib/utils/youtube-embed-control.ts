/* Commento didattico:
 * Scopo del file: comandi `postMessage` verso l'iframe YouTube incorporato, senza caricare lo script IFrame API.
 * Moduli richiamati: nessuno (la CSP `script-src 'self'` vieta lo script esterno; basta `enablejsapi=1` sull'iframe).
 * Flusso: la lista di frasi chiama `seekEmbeddedPlayer`, che invia `seekTo` e poi `playVideo` all'origine dell'iframe.
 */

/** Id DOM dell'iframe del lettore incorporato nella pagina video. */
export const EMBED_PLAYER_ELEMENT_ID = 'utraya-video-player'

/** Messaggio di handshake: chiede al player di inviare eventi e accettare comandi. */
export const EMBED_LISTENING_MESSAGE = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' })

/** Comando per spostare la riproduzione al secondo indicato. */
export function buildSeekCommand(seconds: number): string {
  return JSON.stringify({ event: 'command', func: 'seekTo', args: [Math.max(0, Math.floor(seconds)), true] })
}

/** Comando per avviare la riproduzione. */
export function buildPlayCommand(): string {
  return JSON.stringify({ event: 'command', func: 'playVideo', args: [] })
}

/**
 * Sposta il lettore incorporato a `seconds` e lo avvia. Restituisce false se l'iframe non è disponibile
 * (il chiamante lascia comunque il link "apri su YouTube").
 */
export function seekEmbeddedPlayer(iframe: HTMLIFrameElement | null, seconds: number): boolean {
  const target = iframe?.contentWindow
  if (!iframe || !target) return false
  let origin: string
  try {
    origin = new URL(iframe.src).origin
  } catch {
    return false
  }
  target.postMessage(buildSeekCommand(seconds), origin)
  target.postMessage(buildPlayCommand(), origin)
  return true
}
