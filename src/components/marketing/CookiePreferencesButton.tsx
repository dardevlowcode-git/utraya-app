/* Commento didattico:
 * Scopo del file: bottone client nel footer per riaprire il banner preferenze cookie in qualsiasi momento.
 * Moduli richiamati: `@/lib/consent/ConsentProvider`, `next-intl`.
 * Flusso: richiama `openBanner` dal context consenso senza refresh o navigazioni aggiuntive.
 */

'use client'

import { useTranslations } from 'next-intl'
import { useConsent } from '@/lib/consent/ConsentProvider'

export default function CookiePreferencesButton() {
  const t = useTranslations()
  const { openBanner } = useConsent()

  return (
    <button
      type="button"
      onClick={openBanner}
      className="text-sm text-white/80 transition-colors hover:text-light-signal-orange underline underline-offset-4"
    >
      {t('marketing.cookies.managePreferences')}
    </button>
  )
}