/* Commento didattico:
 * Scopo del file: contiene un componente per la gestione della lingua e dei testi localizzati.
 * Moduli richiamati: `next/navigation`, `next-intl`, `@/lib/i18n/config`
 * Flusso: Il componente riceve dati da pagine/layout parent, usa eventuali hook/utilita` e restituisce markup riusabile.
 */

'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { localeCookieName, localeNames, locales, type Locale } from '@/lib/i18n/config'

const oneYearInSeconds = 60 * 60 * 24 * 365

export default function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()

  function setLocale(nextLocale: Locale) {
    document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=${oneYearInSeconds}; samesite=lax`
    router.refresh()
  }

  return (
    <div className="inline-flex items-center rounded-full border border-outline-variant/20 bg-surface-container-low p-1">
      {locales.map((option) => {
        const selected = option === locale
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLocale(option)}
            aria-pressed={selected}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide transition-colors',
              selected
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            {localeNames[option]}
          </button>
        )
      })}
    </div>
  )
}
