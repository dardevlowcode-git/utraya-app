/* Commento didattico:
 * Scopo del file: pagina FAQ pubblica con ritmo editoriale e accordion accessibile.
 * Moduli richiamati: `next-intl/server`, template sezioni marketing.
 */

import { getTranslations } from 'next-intl/server'
import { SplitHeroSection } from '@/components/marketing/SectionTemplates'

export default async function FaqPage() {
  const t = await getTranslations()
  const faqItems = [
    { q: t('marketing.landing.faq.q1'), a: t('marketing.landing.faq.a1') },
    { q: t('marketing.landing.faq.q2'), a: t('marketing.landing.faq.a2') },
    { q: t('marketing.landing.faq.q3'), a: t('marketing.landing.faq.a3') },
    { q: t('marketing.landing.faq.q4'), a: t('marketing.landing.faq.a4') },
    { q: t('marketing.landing.faq.q5'), a: t('marketing.landing.faq.a5') },
    { q: t('marketing.landing.faq.q6'), a: t('marketing.landing.faq.a6') },
  ]

  return (
    <div className="bg-surface-base">
      <SplitHeroSection title={t('marketing.nav.faq')} subtitle={<p>{t('marketing.pages.faq.subtitle')}</p>} tone="base" />

      <section className="bg-surface-elevated px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="space-y-4">
            {faqItems.map((item) => (
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
