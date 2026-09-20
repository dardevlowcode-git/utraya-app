/* Commento didattico:
 * Scopo del file: verifica parser/serializer consenso cookie e comportamento su mismatch versione policy.
 * Moduli richiamati: helper esportati da ConsentProvider.
 * Flusso: valida casi validi/malformati e controllo `isConsentVersionCurrent` per re-prompt banner.
 */

import { describe, expect, it } from 'vitest'
import { isConsentVersionCurrent, parseConsentCookie, serializeConsentCookie, type ConsentState } from '@/lib/consent/ConsentProvider'
import { COOKIE_POLICY_VERSION } from '@/lib/consent/version'

describe('ConsentProvider helpers', () => {
  it('parseConsentCookie ritorna stato valido quando JSON corretto', () => {
    const raw = JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      version: COOKIE_POLICY_VERSION,
      acceptedAt: '2026-05-16T10:00:00.000Z',
    })

    const parsed = parseConsentCookie(raw)
    expect(parsed).toEqual({
      necessary: true,
      analytics: true,
      marketing: false,
      version: COOKIE_POLICY_VERSION,
      acceptedAt: '2026-05-16T10:00:00.000Z',
    })
  })

  it('parseConsentCookie ritorna null con payload malformato', () => {
    expect(parseConsentCookie('{"necessary":false}')).toBeNull()
    expect(parseConsentCookie('not-json')).toBeNull()
  })

  it('serializeConsentCookie produce JSON coerente con parseConsentCookie', () => {
    const state: ConsentState = {
      necessary: true,
      analytics: false,
      marketing: true,
      version: COOKIE_POLICY_VERSION,
      acceptedAt: '2026-05-16T11:00:00.000Z',
    }

    const serialized = serializeConsentCookie(state)
    expect(parseConsentCookie(serialized)).toEqual(state)
  })

  it('isConsentVersionCurrent segnala mismatch versione', () => {
    const stale: ConsentState = {
      necessary: true,
      analytics: false,
      marketing: false,
      version: '2025-01-01-1',
      acceptedAt: '2026-05-16T12:00:00.000Z',
    }

    expect(isConsentVersionCurrent(stale, COOKIE_POLICY_VERSION)).toBe(false)
    expect(isConsentVersionCurrent({ ...stale, version: COOKIE_POLICY_VERSION }, COOKIE_POLICY_VERSION)).toBe(true)
    expect(isConsentVersionCurrent(null, COOKIE_POLICY_VERSION)).toBe(false)
  })
})

