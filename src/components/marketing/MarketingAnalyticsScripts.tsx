/* Commento didattico:
 * Scopo del file: carica script analytics solo con consenso esplicito categoria analytics.
 * Moduli richiamati: `next/script`, `@/lib/consent/ConsentProvider`.
 * Flusso: controlla stato consenso corrente e monta GA solo se analytics=true e measurement id presente.
 */

'use client'

import Script from 'next/script'
import { useConsent } from '@/lib/consent/ConsentProvider'

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

export default function MarketingAnalyticsScripts() {
  const { state } = useConsent()

  if (!state?.analytics || !measurementId) {
    return null
  }

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${measurementId}');`}
      </Script>
    </>
  )
}