/* Commento didattico:
 * Scopo del file: banner consenso cookie con azioni rapide e modal personalizzazione categorie.
 * Moduli richiamati: `next-intl`, `@/lib/consent/ConsentProvider`.
 * Flusso: mostra banner su primo accesso/version mismatch e salva stato consenso nel cookie versionato.
 */

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useConsent } from '@/lib/consent/ConsentProvider'

export default function CookieBanner() {
  const t = useTranslations()
  const { isBannerOpen, closeBanner, saveConsent, state } = useConsent()
  const [showCustomize, setShowCustomize] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  useEffect(() => {
    setAnalytics(state?.analytics ?? false)
    setMarketing(state?.marketing ?? false)
  }, [state])

  useEffect(() => {
    function onEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (showCustomize) {
          setShowCustomize(false)
          return
        }
        saveConsent({ analytics: false, marketing: false })
      }
    }

    if (isBannerOpen) {
      window.addEventListener('keydown', onEsc)
      return () => window.removeEventListener('keydown', onEsc)
    }

    return undefined
  }, [isBannerOpen, showCustomize, saveConsent])

  if (!isBannerOpen) {
    return null
  }

  return (
    <aside role="dialog" aria-modal="true" aria-labelledby="cookie-banner-title" className="fixed bottom-0 left-0 right-0 z-[70] border-t border-stroke-subtle bg-surface-statement p-4 md:p-5 shadow-hero">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <h2 id="cookie-banner-title" className="text-sm font-semibold text-on-surface">{t('marketing.cookies.title')}</h2>
        <p className="text-sm text-on-surface">{t('marketing.cookies.description')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => saveConsent({ analytics: true, marketing: true })}
            className="shell-cta-default px-4 py-2 text-xs"
          >
            {t('marketing.cookies.acceptAll')}
          </button>
          <button
            type="button"
            onClick={() => saveConsent({ analytics: false, marketing: false })}
            className="rounded-full border border-stroke-strong bg-transparent px-4 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-elevated"
          >
            {t('marketing.cookies.rejectNonEssential')}
          </button>
          <button
            type="button"
            onClick={() => setShowCustomize((previous) => !previous)}
            className="text-xs font-semibold text-on-surface underline underline-offset-4"
          >
            {t('marketing.cookies.customize')}
          </button>
          <Link href="/legal/cookie" className="text-xs text-on-surface underline underline-offset-4 hover:text-light-signal-orange">{t('marketing.cookies.policyLink')}</Link>
        </div>

        {showCustomize && (
          <div role="dialog" aria-modal="true" aria-labelledby="cookie-customize-title" className="mt-2 rounded-2xl border border-stroke-subtle bg-surface-elevated p-4">
            <h3 id="cookie-customize-title" className="text-sm font-semibold text-on-surface">{t('marketing.cookies.customizeTitle')}</h3>
            <div className="mt-3 space-y-3 text-sm text-on-surface">
              <label className="flex items-center justify-between gap-3">
                <span>{t('marketing.cookies.necessary')}</span>
                <input type="checkbox" checked disabled aria-label={t('marketing.cookies.necessary')} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>{t('marketing.cookies.analytics')}</span>
                <input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} aria-label={t('marketing.cookies.analytics')} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>{t('marketing.cookies.marketing')}</span>
                <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} aria-label={t('marketing.cookies.marketing')} />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveConsent({ analytics, marketing })}
                className="shell-cta-default px-4 py-2 text-xs"
              >
                {t('marketing.cookies.savePreferences')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCustomize(false)
                  closeBanner()
                }}
                className="rounded-full border border-stroke-subtle px-4 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
