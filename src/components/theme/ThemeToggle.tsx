/* Commento didattico:
 * Scopo del file: fornisce il selettore tema globale (Normale/Dark) visibile nella top navigation.
 * Moduli richiamati: `react`, `next-intl`
 * Flusso: quando l'utente cambia tema, questo componente aggiorna subito `html[data-theme]`
 *         e salva la preferenza sia in `localStorage` sia in cookie; `layout.tsx` leggera` poi il cookie
 *         al reload per disegnare subito il tema corretto senza effetto "flash".
 */

'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type SiteTheme = 'light' | 'dark'

const themeCookieName = 'theme'
const themeStorageKey = 'utraya-theme'
const oneYearInSeconds = 60 * 60 * 24 * 365

function isValidTheme(value: string | null): value is SiteTheme {
  return value === 'light' || value === 'dark'
}

function applyAndPersistTheme(nextTheme: SiteTheme) {
  document.documentElement.setAttribute('data-theme', nextTheme)
  localStorage.setItem(themeStorageKey, nextTheme)
  document.cookie = `${themeCookieName}=${nextTheme}; path=/; max-age=${oneYearInSeconds}; samesite=lax`
}

export default function ThemeToggle() {
  const t = useTranslations()
  const [theme, setTheme] = useState<SiteTheme>('light')

  useEffect(() => {
    const themeFromHtml = document.documentElement.getAttribute('data-theme')
    const themeFromStorage = localStorage.getItem(themeStorageKey)

    const nextTheme: SiteTheme = isValidTheme(themeFromStorage)
      ? themeFromStorage
      : isValidTheme(themeFromHtml)
        ? themeFromHtml
        : 'light'

    setTheme(nextTheme)
    applyAndPersistTheme(nextTheme)
  }, [])

  function setNextTheme(nextTheme: SiteTheme) {
    setTheme(nextTheme)
    applyAndPersistTheme(nextTheme)
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
