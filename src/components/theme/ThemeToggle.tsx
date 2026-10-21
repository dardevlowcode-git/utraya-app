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
        onClick={() => setNextTheme('light')}
        className={[
          'px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide transition-colors',
          theme === 'light'
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:text-on-surface',
        ].join(' ')}
      >
        {t('common.theme.normal')}
      </button>
      <button
        type="button"
        aria-pressed={theme === 'dark'}
        onClick={() => setNextTheme('dark')}
        className={[
          'px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide transition-colors',
          theme === 'dark'
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:text-on-surface',
        ].join(' ')}
      >
        {t('common.theme.dark')}
      </button>
    </div>
  )
}
