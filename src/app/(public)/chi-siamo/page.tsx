/* Commento didattico:
 * Scopo del file: pagina "Chi siamo" pubblica.
 * Moduli richiamati: `next/link`, `next-intl/server`
 * Flusso: presenta il progetto e include sezione canale YouTube con placeholder.
 */

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function AboutPage() {
  const t = await getTranslations()

  return (
    <div className="bg-surface px-6 pb-20 pt-14">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-5xl font-extrabold tracking-tight text-on-surface md:text-6xl">
          {t('marketing.nav.about')}
        </h1>

        <p className="mt-6 text-lg text-on-surface-variant">{t('marketing.pages.about.intro')}</p>

        <section className="mt-12 rounded-[40px] bg-surface-container-low p-8">
          <h2 className="text-3xl font-bold text-on-surface">{t('marketing.pages.about.youtubeTitle')}</h2>
          <p className="mt-3 text-on-surface-variant">{t('marketing.pages.about.youtubeDescription')}</p>
          <p className="mt-5 text-sm text-on-surface-variant">{t('marketing.pages.about.youtubeNamePlaceholder')}</p>
          <p className="mt-1 text-sm text-on-surface-variant">{t('marketing.pages.about.youtubeUrlPlaceholder')}</p>
          <Link
            href="#"
            className="mt-6 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-semibold text-on-primary"
          >
            {t('marketing.pages.about.youtubeCta')}
          </Link>
        </section>
      </div>
    </div>
  )
}
