/* Commento didattico:
 * Scopo del file: gestisce stato consenso cookie marketing/analytics sul marketing site.
 * Moduli richiamati: `react`
 * Flusso: legge/scrive il cookie `cf_consent` e rende stato/funzione a componenti figli tramite context.
 */

'use client'

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'

type ConsentValue = 'accepted' | 'rejected' | 'unset'

type CookieConsentContextValue = {
  consent: ConsentValue
  setConsent: (value: Exclude<ConsentValue, 'unset'>) => void
}

const COOKIE_NAME = 'cf_consent'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const CONSENT_COOKIE_CHANGE_EVENT = 'utraya:marketing-consent-cookie-change'

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null)

/** Legge il valore di consenso dal contenuto corrente del cookie browser. */
export function parseCookieConsentSnapshot(cookieSnapshot: string | null): ConsentValue {
  if (cookieSnapshot === null) return 'unset'

  const cookie = cookieSnapshot
    .split('; ')
    .find((item) => item.startsWith(`${COOKIE_NAME}=`))
    ?.split('=')[1]

  if (cookie === 'accepted' || cookie === 'rejected') {
    return cookie
  }

  return 'unset'
}

/** Sottoscrive il context alle modifiche del cookie fatte in questa scheda. */
function subscribeToConsentCookie(onChange: () => void) {
  window.addEventListener(CONSENT_COOKIE_CHANGE_EVENT, onChange)

  return () => window.removeEventListener(CONSENT_COOKIE_CHANGE_EVENT, onChange)
}

/** Restituisce lo snapshot browser del cookie consenso. */
function getConsentCookieSnapshot() {
  return typeof document === 'undefined' ? null : document.cookie
}

/** Mantiene neutro lo stato del cookie durante SSR e hydration iniziale. */
function getServerConsentCookieSnapshot() {
  return null
}

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const cookieSnapshot = useSyncExternalStore(
    subscribeToConsentCookie,
    getConsentCookieSnapshot,
    getServerConsentCookieSnapshot
  )
  const consent = parseCookieConsentSnapshot(cookieSnapshot)

  function setConsent(value: Exclude<ConsentValue, 'unset'>) {
    document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
    window.dispatchEvent(new Event(CONSENT_COOKIE_CHANGE_EVENT))
  }

  const contextValue = useMemo(
    () => ({ consent, setConsent }),
    [consent]
  )

  return (
    <CookieConsentContext.Provider value={contextValue}>
      {children}
    </CookieConsentContext.Provider>
  )
}

export function useCookieConsent() {
  const context = useContext(CookieConsentContext)
  if (!context) {
    throw new Error('useCookieConsent must be used within CookieConsentProvider')
  }
  return context
}
