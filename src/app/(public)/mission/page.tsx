/* Commento didattico:
 * Scopo del file: pagina missione pubblica.
 * Moduli richiamati: `next-intl/server`
 * Flusso: mostra missione e principi guida del prodotto con copy localizzato.
 */

import { getTranslations } from 'next-intl/server'

export default async function MissionPage() {
  const t = await getTranslations()
  const pillars = [
    t('marketing.pages.mission.pillar1'),
    t('marketing.pages.mission.pillar2'),
    t('marketing.pages.mission.pillar3'),
    t('marketing.pages.mission.pillar4'),
  ]

  return (
    <div className="bg-surface px-6 pb-20 pt-14">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-5xl font-extrabold tracking-tight text-on-surface md:text-6xl">
          {t('marketing.nav.mission')}
        </h1>
        <p className="mt-6 text-lg text-on-surface-variant">{t('marketing.pages.mission.intro1')}</p>
        <p className="mt-4 text-on-surface-variant">{t('marketing.pages.mission.intro2')}</p>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          {pillars.map((pillar) => (
            <article key={pillar} className="rounded-3xl bg-surface-container-low p-6 text-on-surface-variant">
              {pillar}
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
