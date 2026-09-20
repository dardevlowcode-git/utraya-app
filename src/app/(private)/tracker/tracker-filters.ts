/* Commento didattico:
 * Scopo del file: contiene logica pura per combinare filtri stato e filtri durata nel tracker.
 * Moduli richiamati: `@/lib/utils/video-duration`.
 * Flusso: `TrackerClient` invoca queste funzioni per decidere se mostrare ogni video.
 */

import { getVideoDurationBucket } from '@/lib/utils/video-duration'

export type SeenStatus = 'seen' | 'unseen' | 'hidden'

export type SeenFilterState = {
  seen: boolean
  unseen: boolean
  hidden: boolean
}

export type DurationFilterState = {
  under2m: boolean
  under5m: boolean
  between2m30m: boolean
  over30m: boolean
}

/**
 * Applica i filtri tracker a un video.
 */
export function matchesTrackerFilters(params: {
  seenStatus: SeenStatus
  durationSeconds: number | null
  seenFilters: SeenFilterState
  durationFilters: DurationFilterState
}): boolean {
  if (!params.seenFilters[params.seenStatus]) return false

  const bucket = getVideoDurationBucket(params.durationSeconds)
  if (bucket === 'unknown') {
    // Legacy-safe: visibili solo nella vista "tutte durate".
    // Se l'utente restringe un bucket specifico, i record senza durata non passano.
    return params.durationFilters.under2m
      && params.durationFilters.under5m
      && params.durationFilters.between2m30m
      && params.durationFilters.over30m
  }
  const seconds = params.durationSeconds
  if (typeof seconds !== 'number') return false

  if (seconds < 120) {
    return params.durationFilters.under2m || params.durationFilters.under5m
  }
  if (seconds < 300) {
    return params.durationFilters.under5m || params.durationFilters.between2m30m
  }
  if (seconds <= 1800) {
    return params.durationFilters.between2m30m
  }
  return params.durationFilters.over30m
}
