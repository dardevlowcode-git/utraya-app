/* Commento didattico:
 * Scopo del file: landing pubblica marketing con layout editoriale a blocchi riusabili.
 * Moduli richiamati: `next`, `next/link`, `next-intl/server`, componenti hero e template sezioni.
 * Flusso: compone contenuti localizzati in tre template visivi (split hero, editorial grid, statement band).
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import HeroOrbital from '@/components/marketing/HeroOrbital'
import { EditorialGridSection, SplitHeroSection, StatementBand } from '@/components/marketing/SectionTemplates'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()
  return {
    title: t('marketing.landing.metaTitle'),
    description: t('marketing.landing.metaDescription'),
  }
}

export default async function LandingPage() {
  const t = await getTranslations()

  const howItWorksSteps = [
    { title: t('marketing.landing.howItWorks.step1.title'), description: t('marketing.landing.howItWorks.step1.description') },
    { title: t('marketing.landing.howItWorks.step2.title'), description: t('marketing.landing.howItWorks.step2.description') },
    { title: t('marketing.landing.howItWorks.step3.title'), description: t('marketing.landing.howItWorks.step3.description') },
    { title: t('marketing.landing.howItWorks.step4.title'), description: t('marketing.landing.howItWorks.step4.description') },
  ]

  const problemTags = [
    t('marketing.landing.problem.tag1'),
    t('marketing.landing.problem.tag2'),
    t('marketing.landing.problem.tag3'),
    t('marketing.landing.problem.tag4'),
  ]

  const features = [
    { title: t('marketing.landing.features.items.youtube.title'), incoming: false },
    { title: t('marketing.landing.features.items.podcast.title'), incoming: true },
    { title: t('marketing.landing.features.items.text.title'), incoming: false },
    { title: t('marketing.landing.features.items.audio.title'), incoming: true },
    { title: t('marketing.landing.features.items.tts.title'), incoming: true },
    { title: t('marketing.landing.features.items.playlists.title'), incoming: true },
  ]

  const pricingBullets = [
    t('marketing.landing.pricing.bullet1'),
    t('marketing.landing.pricing.bullet2'),
    t('marketing.landing.pricing.bullet3'),
    t('marketing.landing.pricing.bullet4'),
  ]

  const useCases = [
    t('marketing.landing.useCases.item1'),
    t('marketing.landing.useCases.item2'),
    t('marketing.landing.useCases.item3'),
    t('marketing.landing.useCases.item4'),
    t('marketing.landing.useCases.item5'),
  ]

  const faqItems = [
    { q: t('marketing.landing.faq.q1'), a: t('marketing.landing.faq.a1') },
    { q: t('marketing.landing.faq.q2'), a: t('marketing.landing.faq.a2') },
    { q: t('marketing.landing.faq.q3'), a: t('marketing.landing.faq.a3') },
    { q: t('marketing.landing.faq.q4'), a: t('marketing.landing.faq.a4') },
    { q: t('marketing.landing.faq.q5'), a: t('marketing.landing.faq.a5') },
    { q: t('marketing.landing.faq.q6'), a: t('marketing.landing.faq.a6') },
  ]

  const orbitalNodes = [
    t('marketing.hero.nodes.video'),
    t('marketing.hero.nodes.podcast'),
    t('marketing.hero.nodes.audio'),
    t('marketing.hero.nodes.text'),
    t('marketing.hero.nodes.playlist'),
    t('marketing.hero.nodes.categories'),
    t('marketing.hero.nodes.language'),
    t('marketing.hero.nodes.apiAi'),
  ]

  return (
    <div className="overflow-hidden bg-surface-base">
      <SplitHeroSection
        tone="base"
        title={
          <>
            {t('marketing.landing.hero.headline1')}
            <br />
            {t('marketing.landing.hero.headline2')}
            <br />
            <span className="text-gradient-ai">{t('marketing.landing.hero.headline3')}</span>
          </>
        }
        subtitle={<p>{t('marketing.landing.hero.subtitle')}</p>}
        actions={
          <>
            <Link href="/login" className="shell-cta-default px-8 py-4 text-base">
              {t('marketing.cta.createWatchlist')}
            </Link>
            <Link href="/funzionalita" className="inline-flex items-center justify-center rounded-full border border-stroke-subtle bg-surface-statement px-8 py-4 text-base font-semibold text-on-surface transition-colors hover:bg-surface-elevated">
              {t('marketing.cta.exploreFeatures')}
            </Link>
          </>
        }
        aside={
          <>
            <HeroOrbital ariaLabel={t('marketing.hero.ariaLabel')} centerLabel={t('marketing.hero.center')} nodes={orbitalNodes} />
            <div className="mx-auto max-w-sm rounded-3xl border border-stroke-subtle bg-surface-statement p-6 text-center lg:hidden">
              <p className="text-label-caps text-on-surface-variant">{t('marketing.hero.mobileFallbackTitle')}</p>
              <p className="mt-3 text-sm text-on-surface-variant">{t('marketing.hero.mobileFallbackDescription')}</p>
            </div>
          </>
        }
      />

      <EditorialGridSection
        tone="elevated"
        title={t('marketing.landing.howItWorks.title')}
        subtitle={t('marketing.landing.howItWorks.subtitle')}
        columns="2"
      >
        {howItWorksSteps.map((step) => (
          <article key={step.title} className="rounded-3xl p-6">
            <h3 className="text-card-title text-on-surface">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{step.description}</p>
          </article>
        ))}
      </EditorialGridSection>

      <StatementBand
        title={t('marketing.landing.problem.title')}
        description={t('marketing.landing.problem.description')}
        actions={
          <div className="flex flex-wrap justify-center gap-3">
            {problemTags.map((tag) => (
              <span key={tag} className="rounded-full border border-stroke-subtle bg-surface-statement px-4 py-2 text-sm text-on-surface-variant">
                {tag}
              </span>
            ))}
          </div>
        }
      />

      <EditorialGridSection tone="base" title={t('marketing.landing.features.title')} columns="3">
        {features.map((feature) => (
          <article key={feature.title} className="rounded-3xl p-6">
            <div className="flex items-center justify-between gap-3">
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

      <EditorialGridSection tone="elevated" title={t('marketing.landing.reuse.title')} subtitle={t('marketing.landing.reuse.description')} columns="2">
        <article className="rounded-[32px] p-8">
          <h3 className="text-card-title text-on-surface">{t('marketing.landing.reuse.title')}</h3>
          <p className="mt-3 text-on-surface-variant">{t('marketing.landing.reuse.description')}</p>
          <p className="mt-4 text-legal-note">{t('marketing.landing.reuse.privacyNote')}</p>
        </article>
        <article className="rounded-[32px] p-8">
          <h3 className="text-card-title text-on-surface">{t('marketing.landing.pricing.title')}</h3>
          <p className="mt-3 text-on-surface-variant">{t('marketing.landing.pricing.description')}</p>
          <ul className="mt-4 space-y-2">
            {pricingBullets.map((bullet) => (
              <li key={bullet} className="text-sm text-on-surface-variant">
                • {bullet}
              </li>
            ))}
          </ul>
        </article>
      </EditorialGridSection>

      <EditorialGridSection tone="base" title={t('marketing.landing.useCases.title')} columns="2">
        {useCases.map((item) => (
          <article key={item} className="rounded-3xl p-5 text-on-surface-variant">
            {item}
          </article>
        ))}
      </EditorialGridSection>

      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-section-title text-on-surface">{t('marketing.landing.faq.title')}</h2>
          <div className="mt-8 space-y-4">
            {faqItems.map((item) => (
              <details key={item.q} className="rounded-3xl border border-stroke-subtle bg-surface-statement p-6 shadow-soft">
                <summary className="cursor-pointer list-none text-lg font-semibold text-on-surface">{item.q}</summary>
                <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <StatementBand
        inverse
        title={t('marketing.landing.finalCta.title')}
        actions={
          <Link href="/login" className="inline-flex items-center justify-center rounded-full bg-lifted-cream px-8 py-4 text-base font-semibold text-ink-black transition-colors hover:bg-white">
            {t('marketing.cta.createWatchlist')}
          </Link>
        }
      />
    </div>
  )
}
