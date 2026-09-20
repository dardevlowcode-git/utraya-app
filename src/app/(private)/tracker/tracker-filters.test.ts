/* Commento didattico:
 * Scopo del file: testa combinazioni filtri tracker (stato + durata multi-select).
 * Moduli richiamati: `vitest`, `./tracker-filters`.
 * Flusso: validazione logica pura senza dipendenze UI.
 */

import { describe, expect, it } from 'vitest'
import { matchesTrackerFilters, type DurationFilterState, type SeenFilterState } from './tracker-filters'

const allSeenFilters: SeenFilterState = {
  seen: true,
  unseen: true,
  hidden: true,
}

const allDurationFilters: DurationFilterState = {
  under2m: true,
  under5m: true,
  between2m30m: true,
  over30m: true,
}

describe('tracker filter logic', () => {
  it('esclude video quando stato non selezionato', () => {
    expect(matchesTrackerFilters({
      seenStatus: 'seen',
      durationSeconds: 100,
      seenFilters: { ...allSeenFilters, seen: false },
      durationFilters: allDurationFilters,
    })).toBe(false)
  })

  it('applica filtro durata under2m', () => {
    expect(matchesTrackerFilters({
      seenStatus: 'unseen',
      durationSeconds: 90,
      seenFilters: allSeenFilters,
      durationFilters: { under2m: true, under5m: false, between2m30m: false, over30m: false },
    })).toBe(true)

    expect(matchesTrackerFilters({
      seenStatus: 'unseen',
      durationSeconds: 600,
      seenFilters: allSeenFilters,
      durationFilters: { under2m: true, under5m: false, between2m30m: false, over30m: false },
    })).toBe(false)
  })

  it('applica filtro durata under5m', () => {
    expect(matchesTrackerFilters({
      seenStatus: 'seen',
      durationSeconds: 240,
      seenFilters: allSeenFilters,
      durationFilters: { under2m: false, under5m: true, between2m30m: false, over30m: false },
    })).toBe(true)

    expect(matchesTrackerFilters({
      seenStatus: 'seen',
      durationSeconds: 360,
      seenFilters: allSeenFilters,
      durationFilters: { under2m: false, under5m: true, between2m30m: false, over30m: false },
    })).toBe(false)
  })

  it('mantiene visibili i video con durata sconosciuta solo quando sono attive tutte le durate', () => {
    expect(matchesTrackerFilters({
      seenStatus: 'hidden',
      durationSeconds: null,
      seenFilters: allSeenFilters,
      durationFilters: allDurationFilters,
    })).toBe(true)

    expect(matchesTrackerFilters({
      seenStatus: 'hidden',
      durationSeconds: null,
      seenFilters: allSeenFilters,
      durationFilters: { under2m: true, under5m: false, between2m30m: false, over30m: false },
    })).toBe(false)
  })
})
