/* Commento didattico:
 * Scopo del file: guida l'utente nella creazione e nel salvataggio della chiave YouTube Data API.
 * Moduli richiamati: `next-intl` per il testo IT/EN e collegamenti alle fonti ufficiali Google.
 * Flusso: disclosure nativa, istruzioni console, limiti quota e indicazioni di sicurezza.
 */

'use client'

import { useTranslations } from 'next-intl'

/** Mostra la guida YouTube espandibile nella scheda della relativa integrazione. */
export default function YouTubeApiKeyGuide() {
  const t = useTranslations('integrations.youtubeGuide')

  return (
    <details className="mt-4 w-full rounded-2xl bg-surface-container-low p-4">
      <summary className="cursor-pointer min-h-11 w-full py-2 rounded-md font-semibold text-on-surface underline decoration-from-font underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        {t('summary')}
      </summary>

      <div className="mt-4 space-y-5 text-sm leading-relaxed text-on-surface-variant">
        <p>{t('intro')}</p>

        <div className="rounded-md bg-primary-fixed/40 p-4">
          <p className="font-semibold text-on-surface">{t('credentialTypeTitle')}</p>
          <p className="mt-1">{t('credentialTypeText')}</p>
        </div>

        <ol className="list-decimal space-y-4 pl-5">
          <li>
            <p className="font-semibold text-on-surface">{t('projectTitle')}</p>
            <p>{t('projectText')}</p>
            <a
              href="https://console.cloud.google.com/cloud-resource-manager?walkthrough_id=resource-manager--create-project&start_index=1#step_index=1"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('projectLink')}
            </a>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('enableTitle')}</p>
            <p>{t('enableText')}</p>
            <a
              href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('libraryLink')}
            </a>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('createKeyTitle')}</p>
            <p>{t('createKeyText')}</p>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('credentialsLink')}
            </a>
            <a
              href="https://developers.google.com/youtube/registering_an_application"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('credentialsHelpLink')}
            </a>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('restrictTitle')}</p>
            <p>{t('restrictText')}</p>
            <a
              href="https://docs.cloud.google.com/docs/authentication/api-keys"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('securityLink')}
            </a>
          </li>
          <li>
            <p className="font-semibold text-on-surface">{t('saveTitle')}</p>
            <p>{t('saveText')}</p>
          </li>
        </ol>

        <section aria-labelledby="youtube-guide-quota-title">
          <h4 id="youtube-guide-quota-title" className="font-semibold text-on-surface">
            {t('quotaTitle')}
          </h4>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>{t('quotaSearch')}</li>
            <li>{t('quotaReads')}</li>
            <li>{t('quotaRules')}</li>
          </ul>
          <p className="mt-3">{t('monetaryCost')}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <a
              href="https://developers.google.com/youtube/v3/determine_quota_cost"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('quotaLink')}
            </a>
            <a
              href="https://console.cloud.google.com/iam-admin/quotas"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('quotaConsoleLink')}
            </a>
            <a
              href="https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline underline-offset-4"
            >
              {t('quotaExtensionLink')}
            </a>
          </div>
        </section>

        <section aria-labelledby="youtube-guide-troubleshooting-title">
          <h4 id="youtube-guide-troubleshooting-title" className="font-semibold text-on-surface">
            {t('troubleshootingTitle')}
          </h4>
          <p className="mt-1">{t('troubleshootingText')}</p>
        </section>

        <p className="text-xs">{t('checkedDate')}</p>
      </div>
    </details>
  )
}
