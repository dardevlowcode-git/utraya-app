/* Commento didattico:
 * Scopo del file: gestisce stato consenso cookie marketing/analytics sul marketing site.
 * Moduli richiamati: `react`
 * Flusso: legge/scrive il cookie `cf_consent` e rende stato/funzione a componenti figli tramite context.
 */

'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type ConsentValue = 'accepted' | 'rejected' | 'unset'

type CookieConsentContextValue = {
  consent: ConsentValue
  setConsent: (value: Exclude<ConsentValue, 'unset'>) => void
}

const COOKIE_NAME = 'cf_consent'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null)

function readConsentCookie(): ConsentValue {
  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${COOKIE_NAME}=`))
    ?.split('=')[1]

  if (cookie === 'accepted' || cookie === 'rejected') {
    return cookie
  }

  return 'unset'
}

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsentState] = useState<ConsentValue>('unset')

  useEffect(() => {
    setConsentState(readConsentCookie())
  }, [])

  function setConsent(value: Exclude<ConsentValue, 'unset'>) {
    document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
    setConsentState(value)
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
