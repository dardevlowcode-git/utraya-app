/* Commento didattico:
 * Scopo del file: fornisce context React per consenso cookie versionato e controllo apertura banner preferenze.
 * Moduli richiamati: `react`, `./version`.
 * Flusso: legge/scrive cookie `cf_consent`, espone stato categorie e API `openBanner` per footer/banner.
 */

'use client'

import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react'
import { COOKIE_POLICY_VERSION } from './version'

const COOKIE_NAME = 'cf_consent'
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180
const CONSENT_COOKIE_CHANGE_EVENT = 'utraya:consent-cookie-change'

export type ConsentState = {
  necessary: true
  analytics: boolean
  marketing: boolean
  version: string
  acceptedAt: string
}

type ConsentContextValue = {
  state: ConsentState | null
  isBannerOpen: boolean
  openBanner: () => void
  closeBanner: () => void
  saveConsent: (next: { analytics: boolean; marketing: boolean }) => void
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

export function parseConsentCookie(rawCookie: string): ConsentState | null {
  try {
    const parsed = JSON.parse(rawCookie) as Partial<ConsentState>
    if (parsed.necessary !== true || typeof parsed.analytics !== 'boolean' || typeof parsed.marketing !== 'boolean') {
      return null
    }
    if (typeof parsed.version !== 'string' || typeof parsed.acceptedAt !== 'string') {
      return null
    }
    return {
      necessary: true,
      analytics: parsed.analytics,
      marketing: parsed.marketing,
      version: parsed.version,
      acceptedAt: parsed.acceptedAt,
    }
  } catch {
    return null
  }
}

export function serializeConsentCookie(state: ConsentState): string {
  return JSON.stringify(state)
}

export function isConsentVersionCurrent(state: ConsentState | null, currentVersion = COOKIE_POLICY_VERSION): boolean {
  if (!state) return false
  return state.version === currentVersion
}

/** Estrae e valida il consenso dal cookie browser senza leggere l'ambiente globale. */
export function parseConsentCookieHeader(cookieHeader: string | null): ConsentState | null {
  if (cookieHeader === null) return null

  const cookieValue = cookieHeader
    .split('; ')
    .find((item) => item.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)

  if (!cookieValue) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(cookieValue)
  } catch {
    return null
  }

  return parseConsentCookie(decoded)
}

/** Sottoscrive i consumatori ai salvataggi consenso effettuati in questa scheda. */
function subscribeToConsentCookie(onChange: () => void) {
  window.addEventListener(CONSENT_COOKIE_CHANGE_EVENT, onChange)

  return () => window.removeEventListener(CONSENT_COOKIE_CHANGE_EVENT, onChange)
}

/** Restituisce l'header cookie attuale solo nel browser. */
function getConsentCookieSnapshot() {
  return typeof document === 'undefined' ? null : document.cookie
}

/** Fornisce uno snapshot assente e stabile a SSR e hydration iniziale. */
function getServerConsentCookieSnapshot() {
  return null
}

function writeConsentCookie(state: ConsentState) {
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(serializeConsentCookie(state))}; path=/; max-age=${SIX_MONTHS_SECONDS}; samesite=lax${secure}`
  window.dispatchEvent(new Event(CONSENT_COOKIE_CHANGE_EVENT))
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const cookieHeader = useSyncExternalStore(
    subscribeToConsentCookie,
    getConsentCookieSnapshot,
    getServerConsentCookieSnapshot
  )
  const state = useMemo(() => parseConsentCookieHeader(cookieHeader), [cookieHeader])
  const [bannerOpenOverride, setBannerOpenOverride] = useState<boolean | null>(null)
  const isBannerOpen = bannerOpenOverride ?? (
    cookieHeader !== null && !isConsentVersionCurrent(state)
  )

  function openBanner() {
    setBannerOpenOverride(true)
  }

  function closeBanner() {
    setBannerOpenOverride(false)
  }

  function saveConsent(next: { analytics: boolean; marketing: boolean }) {
    const saved: ConsentState = {
      necessary: true,
      analytics: next.analytics,
      marketing: next.marketing,
      version: COOKIE_POLICY_VERSION,
      acceptedAt: new Date().toISOString(),
    }

    writeConsentCookie(saved)
    setBannerOpenOverride(false)
  }

  const contextValue = useMemo(
    () => ({ state, isBannerOpen, openBanner, closeBanner, saveConsent }),
    [state, isBannerOpen]
  )

  return <ConsentContext.Provider value={contextValue}>{children}</ConsentContext.Provider>
}

export function useConsent() {
  const context = useContext(ConsentContext)
  if (!context) {
    throw new Error('useConsent must be used within ConsentProvider')
  }
  return context
}
