/* Commento didattico:
 * Scopo del file: estrarre in modo robusto un video id YouTube da id/raw value o URL.
 * Moduli richiamati: API URL native.
 * Flusso: chiamanti passano valore potenzialmente eterogeneo (id, watch URL, embed URL) e ricevono id normalizzato o null.
 */

const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

/**
 * Valida in modo conservativo il formato di un video id YouTube.
 */
function isValidYouTubeVideoId(value: string): boolean {
  return YOUTUBE_VIDEO_ID_REGEX.test(value)
}

/**
 * Prova ad estrarre un video id YouTube da un input libero (id o URL comuni).
 */
export function extractYouTubeVideoId(input: string | null | undefined): string | null {
  const raw = input?.trim()
  if (!raw) return null

  if (isValidYouTubeVideoId(raw)) {
    return raw
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()
  const pathname = parsed.pathname

  if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
    const shortId = pathname.slice(1).split('/')[0]
    return isValidYouTubeVideoId(shortId) ? shortId : null
  }

  if (hostname !== 'youtube.com' && hostname !== 'www.youtube.com' && hostname !== 'm.youtube.com') {
    return null
  }

  const queryId = parsed.searchParams.get('v')
  if (queryId && isValidYouTubeVideoId(queryId)) {
    return queryId
  }

  const pathMatch = pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/)
  if (pathMatch) {
    return pathMatch[1]
  }

  return null
}
