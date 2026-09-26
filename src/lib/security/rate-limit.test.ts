/* Commento didattico:
 * Scopo del file: verifica il rate limiting in-memory senza rete, database o timer reali.
 * Moduli richiamati: `../rate-limit`, `vitest`.
 * Flusso: esercita finestra fissa, reset temporale e isolamento per chiave con orologio iniettato.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimits } from './rate-limit'

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimits()
  })

  it('permette le richieste entro la soglia e scala il contatore restante', () => {
    const first = checkRateLimit('user-1', 3, 60_000, 1_000)
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(2)

    const second = checkRateLimit('user-1', 3, 60_000, 2_000)
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(1)

    const third = checkRateLimit('user-1', 3, 60_000, 3_000)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)
  })

  it('rifiuta oltre la soglia con tempo di attesa fino al reset', () => {
    checkRateLimit('broker:1.2.3.4', 2, 60_000, 1_000)
    checkRateLimit('broker:1.2.3.4', 2, 60_000, 2_000)
    const blocked = checkRateLimit('broker:1.2.3.4', 2, 60_000, 3_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetAfterMs).toBe(58_000)
  })

  it('riapre la finestra dopo la scadenza', () => {
    checkRateLimit('user-2', 1, 60_000, 1_000)
    expect(checkRateLimit('user-2', 1, 60_000, 2_000).allowed).toBe(false)
    const reopened = checkRateLimit('user-2', 1, 60_000, 61_000)
    expect(reopened.allowed).toBe(true)
    expect(reopened.remaining).toBe(0)
  })

  it('isola i contatori per chiave', () => {
    checkRateLimit('user-a', 1, 60_000, 1_000)
    expect(checkRateLimit('user-b', 1, 60_000, 2_000).allowed).toBe(true)
    expect(checkRateLimit('user-a', 1, 60_000, 3_000).allowed).toBe(false)
  })
})
