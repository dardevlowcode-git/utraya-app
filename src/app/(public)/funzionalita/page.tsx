/* Commento didattico:
 * Scopo del file: pagina pubblica "Funzionalità" con template editoriali condivisi.
 * Moduli richiamati: `next/link`, `next-intl/server`, template sezioni marketing.
 */

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { EditorialGridSection, SplitHeroSection, StatementBand } from '@/components/marketing/SectionTemplates'

export default async function FeaturesPage() {
  const t = await getTranslations()

  const steps = [
    { title: t('marketing.landing.howItWorks.step1.title'), description: t('marketing.landing.howItWorks.step1.description') },
    { title: t('marketing.landing.howItWorks.step2.title'), description: t('marketing.landing.howItWorks.step2.description') },
    { title: t('marketing.landing.howItWorks.step3.title'), description: t('marketing.landing.howItWorks.step3.description') },
    { title: t('marketing.landing.howItWorks.step4.title'), description: t('marketing.landing.howItWorks.step4.description') },
  ]

  const features = [
    { title: t('marketing.landing.features.items.youtube.title'), incoming: false },
    { title: t('marketing.landing.features.items.podcast.title'), incoming: true },
    { title: t('marketing.landing.features.items.text.title'), incoming: false },
    { title: t('marketing.landing.features.items.audio.title'), incoming: true },
    { title: t('marketing.landing.features.items.tts.title'), incoming: true },
    { title: t('marketing.landing.features.items.playlists.title'), incoming: true },
  ]

  const supportBlocks = [
    { title: t('marketing.pages.features.support.languageTitle'), description: t('marketing.pages.features.support.languageDescription') },
    { title: t('marketing.pages.features.support.apiTitle'), description: t('marketing.pages.features.support.apiDescription') },
    { title: t('marketing.pages.features.support.reuseTitle'), description: t('marketing.pages.features.support.reuseDescription') },
  ]

  return (
    <div className="bg-surface-base">
      <SplitHeroSection
        tone="base"
        title={t('marketing.pages.features.title')}
        subtitle={<p>{t('marketing.pages.features.subtitle')}</p>}
        actions={
          <Link href="/login" className="shell-cta-default px-8 py-4 text-base">
            {t('marketing.cta.createWatchlist')}
          </Link>
        }
      />

      <EditorialGridSection tone="elevated" title={t('marketing.landing.howItWorks.title')} columns="2">
        {steps.map((step) => (
          <article key={step.title} className="rounded-3xl p-6">
            <h3 className="text-card-title text-on-surface">{step.title}</h3>
            <p className="mt-2 text-sm text-on-surface-variant">{step.description}</p>
          </article>
        ))}
      </EditorialGridSection>

      <EditorialGridSection tone="base" title={t('marketing.landing.features.title')} columns="3">
        {features.map((feature) => (
          <article key={feature.title} className="rounded-3xl p-6">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-card-title text-on-surface">{feature.title}</h3>
              {feature.incoming && (
                <span className="rounded-full bg-secondary-fixed px-3 py-1 text-xs font-semibold uppercase tracking-wide text-on-secondary-fixed">
                  {t('marketing.badgeComingSoon')}
                </span>
              )}
            </div>
          </article>
        ))}
      </EditorialGridSection>

      <EditorialGridSection tone="elevated" title={t('marketing.pages.features.support.languageTitle')} columns="3">
        {supportBlocks.map((block) => (
          <article key={block.title} className="rounded-3xl p-6">
            <h3 className="text-card-title text-on-surface">{block.title}</h3>
            <p className="mt-3 text-sm text-on-surface-variant">{block.description}</p>
          </article>
        ))}
      </EditorialGridSection>

      <StatementBand
        inverse
        title={t('marketing.pages.features.finalCtaTitle')}
        actions={
          <Link href="/login" className="inline-flex items-center justify-center rounded-full bg-lifted-cream px-8 py-4 text-base font-semibold text-ink-black transition-colors hover:bg-white">
            {t('marketing.cta.createWatchlist')}
          </Link>
        }
      />
    </div>
  )
}
