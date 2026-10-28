/**
 * Converte `MM:SS` o `H:MM:SS` (anche `MM` oltre 59, come nei video lunghi) in secondi interi.
 * Accetta anche un numero di secondi. Restituisce null per formati non riconosciuti.
 */
export function parseTranscriptTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
  }
  if (typeof value !== 'string') return null
  const match = /^\s*(?:(\d{1,3}):)?(\d{1,4}):(\d{1,2})(?:[.,]\d+)?\s*$/.exec(value)
  if (!match) return null
  const [, hoursPart, minutesPart, secondsPart] = match
  const seconds = Number(secondsPart)
  if (seconds > 59) return null
  const total = Number(hoursPart ?? 0) * 3600 + Number(minutesPart) * 60 + seconds
  return Number.isSafeInteger(total) ? total : null
}

/** Etichetta `m:ss` oppure `h:mm:ss` per un secondo intero non negativo. */
export function formatTranscriptTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`
}

/** Link YouTube al secondo indicato (Link al minuto). */
export function buildYoutubeTimeUrl(youtubeVideoId: string, startSeconds: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}&t=${Math.max(0, Math.floor(startSeconds))}s`
}
