/* Commento didattico:
 * Scopo del file: fornisce il selettore tema globale (Normale/Dark) visibile nella top navigation.
 * Moduli richiamati: `react`, `next-intl`
 * Flusso: quando l'utente cambia tema, questo componente aggiorna subito `html[data-theme]`
 *         e salva la preferenza sia in `localStorage` sia in cookie; `layout.tsx` leggera` poi il cookie
 *         al reload per disegnare subito il tema corretto senza effetto "flash".
 */

'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'

type SiteTheme = 'light' | 'dark'

const themeCookieName = 'theme'
const themeStorageKey = 'utraya-theme'
const oneYearInSeconds = 60 * 60 * 24 * 365
const THEME_CHANGE_EVENT = 'utraya:theme-change'

function isValidTheme(value: string | null): value is SiteTheme {
  return value === 'light' || value === 'dark'
}

/** Risolve la preferenza tema mantenendo priorità al valore persistito. */
export function resolveTheme(themeFromStorage: string | null, themeFromHtml: string | null): SiteTheme {
  if (isValidTheme(themeFromStorage)) return themeFromStorage
  if (isValidTheme(themeFromHtml)) return themeFromHtml
  return 'light'
}

/** Sottoscrive il selettore ai cambi tema prodotti da questa scheda. */
function subscribeToThemeChanges(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange)

  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange)
}

/** Legge il tema preferito da storage o dall'attributo root del documento. */
function getThemeSnapshot(): SiteTheme {
  return resolveTheme(
    localStorage.getItem(themeStorageKey),
    document.documentElement.getAttribute('data-theme')
  )
}

/** Mantiene il tema chiaro nello snapshot server e nella hydration iniziale. */
function getServerThemeSnapshot(): SiteTheme {
  return 'light'
}

function applyAndPersistTheme(nextTheme: SiteTheme) {
  document.documentElement.setAttribute('data-theme', nextTheme)
  localStorage.setItem(themeStorageKey, nextTheme)
  document.cookie = `${themeCookieName}=${nextTheme}; path=/; max-age=${oneYearInSeconds}; samesite=lax`
}

export default function ThemeToggle() {
  const t = useTranslations()
  const theme = useSyncExternalStore(
    subscribeToThemeChanges,
    getThemeSnapshot,
    getServerThemeSnapshot
  )

  useEffect(() => {
    applyAndPersistTheme(getThemeSnapshot())
  }, [])

  function setNextTheme(nextTheme: SiteTheme) {
    applyAndPersistTheme(nextTheme)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }

  return (
    <div
      className="inline-flex items-center rounded-full border border-outline-variant/20 bg-surface-container-low p-1"
      role="group"
      aria-label={t('common.theme.label')}
    >
      <button
        type="button"
        aria-pressed={theme === 'light'}
        aria-label={t('common.theme.normal')}
        onClick={() => setNextTheme('light')}
        className={[
          'flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 py-2 text-xs font-semibold uppercase tracking-wide transition-colors md:min-h-0 md:min-w-0 md:px-3 md:py-1.5',
          theme === 'light'
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:text-on-surface',
        ].join(' ')}
      >
        <svg className="h-4 w-4 md:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
        </svg>
        <span className="hidden md:inline">{t('common.theme.normal')}</span>
      </button>
      <button
        type="button"
        aria-pressed={theme === 'dark'}
        aria-label={t('common.theme.dark')}
        onClick={() => setNextTheme('dark')}
        className={[
          'flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 py-2 text-xs font-semibold uppercase tracking-wide transition-colors md:min-h-0 md:min-w-0 md:px-3 md:py-1.5',
          theme === 'dark'
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:text-on-surface',
        ].join(' ')}
      >
        <svg className="h-4 w-4 md:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
        </svg>
        <span className="hidden md:inline">{t('common.theme.dark')}</span>
      </button>
    </div>
  )
}
