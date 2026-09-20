/* Commento didattico:
 * Scopo del file: selettore lingua dedicato alle superfici marketing pubbliche.
 * Moduli richiamati: `next/navigation`, `next-intl`, `@/lib/i18n/config`
 * Flusso: aggiorna il cookie locale, poi forza un refresh della pagina server-rendered.
 */

'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { localeCookieName, localeNames, locales, type Locale } from '@/lib/i18n/config'

const oneYearInSeconds = 60 * 60 * 24 * 365

export default function MarketingLanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()

  function setLocale(nextLocale: Locale) {
    document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=${oneYearInSeconds}; samesite=lax`
    router.refresh()
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface-container-low p-1">
      {locales.map((option) => {
        const selected = option === locale
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLocale(option)}
            aria-pressed={selected}
            className={[
              'rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
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
