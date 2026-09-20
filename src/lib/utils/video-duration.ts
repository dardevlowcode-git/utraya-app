/* Commento didattico:
 * Scopo del file: centralizza parsing, formattazione e classificazione della durata video.
 * Moduli richiamati: nessuno.
 * Flusso: i service usano il parser ISO-8601 YouTube; la UI usa formatter e bucket coerenti.
 */

export type VideoDurationBucket = 'under_2m' | 'between_2m_30m' | 'over_30m' | 'unknown'

/**
 * Converte la durata ISO-8601 di YouTube (es. PT1H3M5S) in secondi.
 */
export function parseYouTubeDurationToSeconds(value: string | null | undefined): number | null {
  if (!value) return null

  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim())
  if (!match) return null

  const hours = Number(match[1] ?? '0')
  const minutes = Number(match[2] ?? '0')
  const seconds = Number(match[3] ?? '0')

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null
  }

  const total = (hours * 3600) + (minutes * 60) + seconds
  return total > 0 ? total : null
}

/**
 * Restituisce un bucket di durata leggibile lato prodotto.
 */
export function getVideoDurationBucket(seconds: number | null | undefined): VideoDurationBucket {
  if (seconds === null || seconds === undefined || seconds <= 0) return 'unknown'
  if (seconds < 120) return 'under_2m'
  if (seconds <= 1800) return 'between_2m_30m'
  return 'over_30m'
}

/**
 * Formatta la durata in mm:ss o h:mm:ss.
 */
export function formatVideoDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds <= 0) return null

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return `${m}:${String(s).padStart(2, '0')}`
}
