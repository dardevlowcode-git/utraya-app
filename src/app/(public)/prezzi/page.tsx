/* Commento didattico:
 * Scopo del file: pagina prezzi marketing con blocchi statement + faq editoriale.
 * Moduli richiamati: `next-intl/server`, template sezioni marketing.
 */

import { getTranslations } from 'next-intl/server'
import { EditorialGridSection, SplitHeroSection, StatementBand } from '@/components/marketing/SectionTemplates'

export default async function PricingPage() {
  const t = await getTranslations()

  const faq = [
    { q: t('marketing.pages.pricing.faq.q1'), a: t('marketing.pages.pricing.faq.a1') },
    { q: t('marketing.pages.pricing.faq.q2'), a: t('marketing.pages.pricing.faq.a2') },
    { q: t('marketing.pages.pricing.faq.q3'), a: t('marketing.pages.pricing.faq.a3') },
    { q: t('marketing.pages.pricing.faq.q4'), a: t('marketing.pages.pricing.faq.a4') },
    { q: t('marketing.pages.pricing.faq.q5'), a: t('marketing.pages.pricing.faq.a5') },
  ]

  return (
    <div className="bg-surface-base">
      <SplitHeroSection
        title={t('marketing.pages.pricing.title')}
        subtitle={<p>{t('marketing.pages.pricing.freePlanDescription')}</p>}
        tone="base"
      />

      <EditorialGridSection tone="elevated" title={t('marketing.pages.pricing.freePlanTitle')} columns="2">
        <article className="rounded-[32px] p-8">
          <h3 className="text-card-title text-on-surface">{t('marketing.pages.pricing.freePlanTitle')}</h3>
          <p className="mt-2 text-2xl font-bold text-on-surface">{t('marketing.pages.pricing.freePlanPrice')}</p>
          <p className="mt-3 text-on-surface-variant">{t('marketing.pages.pricing.freePlanDescription')}</p>
        </article>
        <article className="rounded-[32px] p-8">
          <h3 className="text-card-title text-on-surface">{t('marketing.pages.pricing.apiBlockTitle')}</h3>
          <p className="mt-3 text-on-surface-variant">{t('marketing.pages.pricing.apiBlockDescription')}</p>
        </article>
      </EditorialGridSection>

      <StatementBand title={t('marketing.pages.pricing.keyMessageTitle')} description={t('marketing.pages.pricing.keyMessageDescription')} />

      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-section-title text-on-surface">{t('marketing.pages.pricing.faq.title')}</h2>
          <div className="mt-6 space-y-4">
            {faq.map((item) => (
              <details key={item.q} className="rounded-3xl border border-stroke-subtle bg-surface-statement p-6 shadow-soft">
                <summary className="cursor-pointer list-none text-lg font-semibold text-on-surface">{item.q}</summary>
                <p className="mt-3 text-sm text-on-surface-variant">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
