/* Commento didattico:
 * Scopo del file: definisce il layout pubblico marketing e collega provider consenso cookie + analytics gating.
 * Moduli richiamati: componenti marketing, `@/lib/consent/ConsentProvider`, `next-intl/server`.
 * Flusso: avvolge tutte le pagine pubbliche con shell marketing e controlli cookie centralizzati.
 */

import MarketingHeader from '@/components/marketing/MarketingHeader'
import MarketingFooter from '@/components/marketing/MarketingFooter'
import { ConsentProvider } from '@/lib/consent/ConsentProvider'
import CookieBanner from '@/components/marketing/CookieBanner'
import MarketingAnalyticsScripts from '@/components/marketing/MarketingAnalyticsScripts'
import { getTranslations } from 'next-intl/server'

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const t = await getTranslations()

  return (
    <ConsentProvider>
      <div className="flex min-h-screen flex-col bg-surface">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-primary"
        >
          {t('marketing.a11y.skipToContent')}
        </a>
        <MarketingHeader />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <MarketingFooter />
        <CookieBanner />
        <MarketingAnalyticsScripts />
      </div>
    </ConsentProvider>
  )
}