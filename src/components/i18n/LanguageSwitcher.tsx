'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { localeNames, locales, type Locale } from '@/lib/i18n/config'
import { writeLocaleCookie } from '@/lib/i18n/locale-cookie'

export default function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()

  function setLocale(nextLocale: Locale) {
    writeLocaleCookie(nextLocale)
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
            aria-label={localeNames[option]}
            className={[
              'flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 py-2 text-xs font-semibold uppercase tracking-wide transition-colors md:min-h-0 md:min-w-0 md:px-3 md:py-1.5',
              selected
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            <span className="md:hidden" aria-hidden="true">{option.toUpperCase()}</span>
            <span className="hidden md:inline">{localeNames[option]}</span>
          </button>
        )
      })}
    </div>
  )
}
