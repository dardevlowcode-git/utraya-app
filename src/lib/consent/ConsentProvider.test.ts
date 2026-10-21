/* Commento didattico:
 * Scopo del file: verifica parsing sicuro, hydration e interazioni del banner consenso.
 * Moduli richiamati: `ConsentProvider`, `CookieBanner`, React SSR/client e helper consenso.
 * Flusso: copre cookie validi/malformati, mismatch versione, salvataggio e ripristino preferenze.
 */

// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CookieBanner from '@/components/marketing/CookieBanner'
import { renderHydrated } from '@/__tests__/client-render'
import {
  ConsentProvider,
  isConsentVersionCurrent,
  parseConsentCookie,
  parseConsentCookieHeader,
  serializeConsentCookie,
  useConsent,
  type ConsentState,
} from '@/lib/consent/ConsentProvider'
import { COOKIE_POLICY_VERSION } from '@/lib/consent/version'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

function ConsentSnapshot() {
  const { state, isBannerOpen } = useConsent()
  return createElement('span', {
    'data-consent-state': state ? 'loaded' : 'unset',
    'data-banner-open': isBannerOpen ? 'true' : 'false',
  })
}

/** Espone lo stato banner/consenso e consente di riaprirlo nel test client. */
function ConsentActions() {
  const { state, isBannerOpen, openBanner } = useConsent()
  return createElement('button', {
    type: 'button',
    'data-testid': 'consent-state',
    'data-banner-open': isBannerOpen ? 'true' : 'false',
    'data-analytics': state ? String(state.analytics) : 'unset',
    'data-marketing': state ? String(state.marketing) : 'unset',
    onClick: openBanner,
  }, 'Apri preferenze')
}

/** Cerca un controllo tramite il testo localizzato fornito dal mock next-intl. */
function buttonByText(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

const consentCookieCases = [
  { case: 'percentuale malformata', value: '%' },
  { case: 'JSON malformato', value: '%7B' },
  {
    case: 'versione superata',
    value: encodeURIComponent(JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: false,
      version: '2025-01-01-1',
      acceptedAt: '2026-05-16T12:00:00.000Z',
    })),
  },
]

afterEach(() => {
  document.cookie = 'cf_consent=; path=/; max-age=0'
})

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

  it('legge il cookie consenso dal relativo header senza confondere altri cookie', () => {
    const current = {
      necessary: true,
      analytics: true,
      marketing: false,
      version: COOKIE_POLICY_VERSION,
      acceptedAt: '2026-05-16T10:00:00.000Z',
    }

    expect(parseConsentCookieHeader(`theme=dark; cf_consent=${encodeURIComponent(JSON.stringify(current))}`)).toEqual(current)
    expect(parseConsentCookieHeader(null)).toBeNull()
    expect(parseConsentCookieHeader('theme=dark')).toBeNull()
  })

  it('tratta encoding percentuale invalido e JSON non valido come consenso assente', () => {
    expect(() => parseConsentCookieHeader('cf_consent=%')).not.toThrow()
    expect(parseConsentCookieHeader('cf_consent=%')).toBeNull()
    expect(parseConsentCookieHeader('cf_consent=%7B')).toBeNull()
  })

  it('mantiene lo stato consenso chiuso e neutro nello snapshot SSR', () => {
    const markup = renderToStaticMarkup(createElement(
      ConsentProvider,
      null,
      createElement(ConsentSnapshot)
    ))

    expect(markup).toContain('data-consent-state="unset"')
    expect(markup).toContain('data-banner-open="false"')
  })

  it.each(consentCookieCases)('apre il banner per cookie $case e salva le preferenze aggiornate', async ({ value }) => {
    document.cookie = `cf_consent=${value}; path=/`
    const mounted = await renderHydrated(createElement(
      ConsentProvider,
      null,
      createElement(CookieBanner),
      createElement(ConsentActions)
    ))

    try {
      expect(mounted.container.querySelector('[aria-labelledby="cookie-banner-title"]')).not.toBeNull()
      expect(mounted.container.querySelector('[data-testid="consent-state"]')?.getAttribute('data-banner-open')).toBe('true')

      await act(async () => buttonByText(mounted.container, 'marketing.cookies.customize').click())
      const analytics = mounted.container.querySelector<HTMLInputElement>('[aria-label="marketing.cookies.analytics"]')!
      const marketing = mounted.container.querySelector<HTMLInputElement>('[aria-label="marketing.cookies.marketing"]')!
      expect(analytics.checked).toBe(false)
      expect(marketing.checked).toBe(false)

      await act(async () => analytics.click())
      await act(async () => marketing.click())
      expect(analytics.checked).toBe(true)
      expect(marketing.checked).toBe(true)

      await act(async () => buttonByText(mounted.container, 'marketing.cookies.savePreferences').click())
      const saved = parseConsentCookieHeader(document.cookie)
      expect(saved?.analytics).toBe(true)
      expect(saved?.marketing).toBe(true)
      expect(isConsentVersionCurrent(saved)).toBe(true)
      expect(mounted.container.querySelector('[aria-labelledby="cookie-banner-title"]')).toBeNull()
      expect(mounted.container.querySelector('[data-testid="consent-state"]')?.getAttribute('data-banner-open')).toBe('false')

      await act(async () => mounted.container.querySelector<HTMLButtonElement>('[data-testid="consent-state"]')?.click())
      expect(mounted.container.querySelector('[aria-labelledby="cookie-banner-title"]')).not.toBeNull()
      expect(mounted.container.querySelector<HTMLInputElement>('[aria-label="marketing.cookies.analytics"]')?.checked).toBe(true)
      expect(mounted.container.querySelector<HTMLInputElement>('[aria-label="marketing.cookies.marketing"]')?.checked).toBe(true)
    } finally {
      await mounted.unmount()
    }
  })
})
