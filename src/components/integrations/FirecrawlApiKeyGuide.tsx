/* Commento didattico:
 * Scopo: guida l'utente alla creazione e gestione sicura della chiave Firecrawl.
 * Moduli richiamati: `next-intl` e le fonti ufficiali Firecrawl.
 * Flusso: descrive salvataggio, discovery metadata, piano e sostituzione senza avviare tool o termini.
 */

'use client'

import { useTranslations } from 'next-intl'

/** Mostra la guida Firecrawl espandibile nella scheda della relativa integrazione. */
export default function FirecrawlApiKeyGuide() {
  const t = useTranslations('integrations.firecrawlGuide')

  return (
    <details className="mt-4 w-full rounded-2xl bg-surface-container-low p-4">
      <summary className="w-full min-h-11 cursor-pointer rounded-md py-2 font-semibold text-on-surface underline decoration-from-font underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        {t('summary')}
      </summary>

      <div className="mt-4 space-y-5 text-sm leading-relaxed text-on-surface-variant">
        <p>{t('intro')}</p>

        <ol className="list-decimal space-y-4 pl-5">
          <li>
            <p className="font-semibold text-on-surface">{t('accountTitle')}</p>
            <p>{t('accountText')}</p>
            <a
              href="https://docs.firecrawl.dev/dashboard#api-keys"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('accountLink')}
            </a>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('createTitle')}</p>
            <p>{t('createText')}</p>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('saveTitle')}</p>
            <p>{t('saveText')}</p>
          </li>
        </ol>

        <section aria-labelledby="firecrawl-guide-discovery-title" className="rounded-md bg-primary-fixed/40 p-4">
          <h4 id="firecrawl-guide-discovery-title" className="font-semibold text-on-surface">
            {t('discoveryTitle')}
          </h4>
          <p className="mt-1">{t('discoveryText')}</p>
        </section>

        <section aria-labelledby="firecrawl-guide-billing-title">
          <h4 id="firecrawl-guide-billing-title" className="font-semibold text-on-surface">
            {t('billingTitle')}
          </h4>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>{t('freePlan')}</li>
            <li>{t('billingText')}</li>
            <li>{t('termsText')}</li>
          </ul>
        </section>

        <section aria-labelledby="firecrawl-guide-replace-title">
          <h4 id="firecrawl-guide-replace-title" className="font-semibold text-on-surface">
            {t('replaceTitle')}
          </h4>
          <p className="mt-1">{t('replaceText')}</p>
        </section>

        <nav aria-label={t('sourcesTitle')}>
          <h4 className="font-semibold text-on-surface">{t('sourcesTitle')}</h4>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            <a
              href="https://docs.firecrawl.dev/features/alexandria"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('alexandriaLink')}
            </a>
            <a
              href="https://docs.firecrawl.dev/billing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('billingLink')}
            </a>
            <a
              href="https://www.firecrawl.dev/terms/third-party-data"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('termsLink')}
            </a>
          </div>
        </nav>

        <p className="text-xs">{t('checkedDate')}</p>
      </div>
    </details>
  )
}
