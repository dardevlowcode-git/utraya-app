/* Commento didattico:
 * Scopo: verifica l'inizializzazione del draft dalle preferenze persistite.
 * Moduli richiamati: helper preferenze di `CookieBanner` e `vitest`.
 * Flusso: confronta il draft derivato da consenso salvato e assenza di consenso.
 */

import { describe, expect, it } from 'vitest'
import { createCookiePreferencesDraft } from './CookieBanner'

describe('CookieBanner', () => {
  it('inizializza i controlli dalle preferenze già salvate', () => {
    const savedState = { analytics: true, marketing: false }

    expect(createCookiePreferencesDraft(savedState)).toEqual({
      consentState: savedState,
      analytics: true,
      marketing: false,
    })
  })

  it('disattiva le preferenze personalizzate quando non esiste un consenso salvato', () => {
    expect(createCookiePreferencesDraft(null)).toEqual({
      consentState: null,
      analytics: false,
      marketing: false,
    })
  })
})
