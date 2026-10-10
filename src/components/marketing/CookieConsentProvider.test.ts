/* Commento didattico:
 * Scopo: verifica parsing, snapshot SSR e aggiornamento client del consenso marketing.
 * Moduli richiamati: `CookieConsentProvider`, React SSR e `vitest`.
 * Flusso: controlla cookie ammessi, stato server neutro e persistenza delle scelte utente.
 */

// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { CookieConsentProvider, parseCookieConsentSnapshot, useCookieConsent } from './CookieConsentProvider'
import { renderHydrated } from '@/__tests__/client-render'

/** Espone al markup di test lo snapshot fornito dal provider. */
function ConsentSnapshot() {
  const { consent } = useCookieConsent()
  return createElement('span', { 'data-consent': consent })
}

/** Espone scelta consenso e snapshot correnti per il test del context client. */
function ConsentControls() {
  const { consent, setConsent } = useCookieConsent()
  return createElement('button', {
    type: 'button',
    'data-testid': 'set-consent',
    'data-consent': consent,
    onClick: () => setConsent(consent === 'accepted' ? 'rejected' : 'accepted'),
  }, 'Cambia consenso')
}

afterEach(() => {
  document.cookie = 'cf_consent=; path=/; max-age=0'
})

describe('CookieConsentProvider', () => {
  it('legge solo gli stati di consenso supportati dal cookie', () => {
    expect(parseCookieConsentSnapshot('theme=dark; cf_consent=accepted')).toBe('accepted')
    expect(parseCookieConsentSnapshot('cf_consent=rejected')).toBe('rejected')
    expect(parseCookieConsentSnapshot('cf_consent=unknown')).toBe('unset')
    expect(parseCookieConsentSnapshot(null)).toBe('unset')
  })

  it('renderizza lo stato neutro sul server prima di leggere il cookie client', () => {
    const markup = renderToStaticMarkup(createElement(
      CookieConsentProvider,
      null,
      createElement(ConsentSnapshot)
    ))

    expect(markup).toContain('data-consent="unset"')
  })

  it('idrata il valore cookie esistente e notifica il context dopo ogni scelta', async () => {
    document.cookie = 'cf_consent=accepted; path=/'
    const mounted = await renderHydrated(createElement(
      CookieConsentProvider,
      null,
      createElement(ConsentControls)
    ))

    try {
      const button = mounted.container.querySelector<HTMLButtonElement>('[data-testid="set-consent"]')!
      expect(button.dataset.consent).toBe('accepted')

      await act(async () => button.click())
      expect(button.dataset.consent).toBe('rejected')
      expect(document.cookie.split('; ').some((cookie) => cookie === 'cf_consent=rejected')).toBe(true)

      await act(async () => button.click())
      expect(button.dataset.consent).toBe('accepted')
      expect(document.cookie.split('; ').some((cookie) => cookie === 'cf_consent=accepted')).toBe(true)
    } finally {
      await mounted.unmount()
    }
  })
})
