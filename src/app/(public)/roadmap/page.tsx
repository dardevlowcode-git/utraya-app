/* Commento didattico:
 * Scopo del file: pagina roadmap in stato "In arrivo a breve".
 * Moduli richiamati: `next-intl/server`
 * Flusso: espone roadmap pubblica placeholder senza date vincolanti.
 */

import { getTranslations } from 'next-intl/server'

export default async function RoadmapPage() {
  const t = await getTranslations()
  const cards = [
    t('marketing.pages.roadmap.card1'),
    t('marketing.pages.roadmap.card2'),
    t('marketing.pages.roadmap.card3'),
    t('marketing.pages.roadmap.card4'),
  ]

  return (
    <div className="bg-surface px-6 pb-20 pt-14">
      <div className="mx-auto max-w-5xl">
        <div className="inline-flex rounded-full bg-secondary-fixed px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-on-secondary-fixed">
          {t('marketing.badgeComingSoon')}
        </div>
        <h1 className="mt-5 text-5xl font-extrabold tracking-tight text-on-surface md:text-6xl">
          {t('marketing.nav.roadmap')}
        </h1>
        <p className="mt-5 text-on-surface-variant">{t('marketing.pages.roadmap.description')}</p>

        <section className="mt-10 grid gap-5 md:grid-cols-2">
          {cards.map((card) => (
            <article key={card} className="rounded-3xl bg-surface-container-low p-6">
              <h2 className="text-lg font-semibold text-on-surface">{card}</h2>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
