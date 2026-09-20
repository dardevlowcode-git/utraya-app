/* Commento didattico:
 * Scopo del file: pagina comparazioni in stato "In arrivo a breve".
 * Moduli richiamati: `next-intl/server`
 * Flusso: mostra placeholder senza citare competitor reali in V1.6.
 */

import { getTranslations } from 'next-intl/server'

export default async function ComparisonsPage() {
  const t = await getTranslations()
  const cards = [
    t('marketing.pages.comparisons.card1'),
    t('marketing.pages.comparisons.card2'),
    t('marketing.pages.comparisons.card3'),
    t('marketing.pages.comparisons.card4'),
  ]

  return (
    <div className="bg-surface px-6 pb-20 pt-14">
      <div className="mx-auto max-w-5xl">
        <div className="inline-flex rounded-full bg-secondary-fixed px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-on-secondary-fixed">
          {t('marketing.badgeComingSoon')}
        </div>
        <h1 className="mt-5 text-5xl font-extrabold tracking-tight text-on-surface md:text-6xl">
          {t('marketing.nav.comparisons')}
        </h1>
        <p className="mt-5 text-on-surface-variant">{t('marketing.pages.comparisons.description')}</p>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          {cards.map((card) => (
            <article key={card} className="rounded-3xl bg-surface-container-low p-6 text-on-surface-variant">
              <p className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant">
                {t('marketing.badgeComingSoon')}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-on-surface">{card}</h2>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
