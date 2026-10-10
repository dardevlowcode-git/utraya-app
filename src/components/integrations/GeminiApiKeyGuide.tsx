/* Commento didattico:
 * Scopo del file: guida l'utente nella creazione e configurazione della chiave Gemini API.
 * Moduli richiamati: `next-intl` per il testo IT/EN e link alle fonti ufficiali Google.
 * Flusso: disclosure nativa, istruzioni AI Studio, piani, limiti, privacy e vincoli territoriali.
 */

'use client'

import { useTranslations } from 'next-intl'

/** Mostra la guida Gemini espandibile nella scheda della relativa integrazione. */
export default function GeminiApiKeyGuide() {
  const t = useTranslations('integrations.geminiGuide')

  return (
    <details className="mt-4 w-full rounded-2xl bg-surface-container-low p-4">
      <summary className="w-full min-h-11 cursor-pointer rounded-md py-2 font-semibold text-on-surface underline decoration-from-font underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        {t('summary')}
      </summary>

      <div className="mt-4 space-y-5 text-sm leading-relaxed text-on-surface-variant">
        <p>{t('intro')}</p>

        <ol className="list-decimal space-y-4 pl-5">
          <li>
            <p className="font-semibold text-on-surface">{t('openTitle')}</p>
            <p>{t('openText')}</p>
            <a
              href="https://aistudio.google.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('apiKeysLink')}
            </a>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('createTitle')}</p>
            <p>{t('createText')}</p>
            <a
              href="https://ai.google.dev/gemini-api/docs/api-key"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('keyDocsLink')}
            </a>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('keyTypeTitle')}</p>
            <p>{t('keyTypeText')}</p>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('saveTitle')}</p>
            <p>{t('saveText')}</p>
          </li>
        </ol>

        <section aria-labelledby="gemini-guide-plan-title">
          <h4 id="gemini-guide-plan-title" className="font-semibold text-on-surface">
            {t('planTitle')}
          </h4>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>{t('freeTier')}</li>
            <li>{t('paidTier')}</li>
            <li>{t('billingSeparation')}</li>
          </ul>
        </section>

        <section aria-labelledby="gemini-guide-region-title" className="rounded-md bg-primary-fixed/40 p-4">
          <h4 id="gemini-guide-region-title" className="font-semibold text-on-surface">
            {t('regionTitle')}
          </h4>
          <p className="mt-1">{t('regionText')}</p>
        </section>

        <section aria-labelledby="gemini-guide-data-title">
          <h4 id="gemini-guide-data-title" className="font-semibold text-on-surface">
            {t('dataTitle')}
          </h4>
          <p className="mt-1">{t('freeData')}</p>
          <p className="mt-2">{t('paidData')}</p>
        </section>

        <section aria-labelledby="gemini-guide-troubleshooting-title">
          <h4 id="gemini-guide-troubleshooting-title" className="font-semibold text-on-surface">
            {t('troubleshootingTitle')}
          </h4>
          <p className="mt-1">{t('troubleshootingText')}</p>
        </section>

        <nav aria-label={t('sourcesTitle')}>
          <h4 className="font-semibold text-on-surface">{t('sourcesTitle')}</h4>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            <a
              href="https://ai.google.dev/gemini-api/docs/billing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('billingLink')}
            </a>
            <a
              href="https://ai.google.dev/gemini-api/docs/rate-limits"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('limitsLink')}
            </a>
            <a
              href="https://ai.google.dev/gemini-api/docs/pricing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('pricingLink')}
            </a>
            <a
              href="https://ai.google.dev/gemini-api/terms"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('termsLink')}
            </a>
            <a
              href="https://ai.google.dev/gemini-api/docs/available-regions"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('regionsLink')}
            </a>
          </div>
        </nav>

        <p className="text-xs">{t('checkedDate')}</p>
      </div>
    </details>
  )
}
