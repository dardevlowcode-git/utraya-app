/* Commento didattico:
 * Scopo del file: testa helper puri del daily sync (due-date e prossima esecuzione).
 * Moduli richiamati: `vitest`, `@/lib/services/daily-sync`
 * Flusso: usa date deterministiche e verifica output previsto delle utility.
 */

import { describe, expect, it } from 'vitest'
import { computeNextSyncIso, isChannelDue } from '@/lib/services/daily-sync'

describe('daily-sync service helpers', () => {
  it('considers channel due when next_sync_at is in the past', () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const due = isChannelDue({
      now,
      syncFrequencyHours: 24,
      syncState: {
        last_sync_at: '2026-04-29T08:00:00.000Z',
        next_sync_at: '2026-04-30T09:59:59.000Z',
      },
    })

    expect(due).toBe(true)
  })

  it('computes next sync by adding the requested frequency', () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    expect(computeNextSyncIso(now, 24)).toBe('2026-05-01T10:00:00.000Z')
    expect(computeNextSyncIso(now, 6)).toBe('2026-04-30T16:00:00.000Z')
  })
})
