/* Commento didattico:
 * Scopo del file: footer marketing con colonne navigazione e azione client per riaprire preferenze cookie.
 * Moduli richiamati: `next/link`, `next-intl/server`, componenti lingua/tema/cookie.
 * Flusso: compone link pubblici fissi e azioni UI condivise su tutte le pagine marketing.
 */

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import MarketingLanguageSwitcher from './LanguageSwitcher'
import ThemeToggle from '@/components/theme/ThemeToggle'
import CookiePreferencesButton from './CookiePreferencesButton'

export default async function MarketingFooter() {
  const t = await getTranslations()
  const year = new Date().getFullYear()

  const columns = [
    {
      title: t('marketing.footer.product'),
      links: [
        { href: '/funzionalita', label: t('marketing.nav.features') },
        { href: '/prezzi', label: t('marketing.nav.pricing') },
        { href: '/faq', label: t('marketing.nav.faq') },
        { href: '/comparazioni', label: t('marketing.nav.comparisons') },
        { href: '/roadmap', label: t('marketing.nav.roadmap') },
      ],
    },
    {
      title: t('marketing.footer.project'),
      links: [
        { href: '/mission', label: t('marketing.nav.mission') },
        { href: '/chi-siamo', label: t('marketing.nav.about') },
      ],
    },
    {
      title: t('marketing.footer.legal'),
      links: [
        { href: '/legal/termini', label: t('marketing.nav.terms') },
        { href: '/legal/privacy', label: t('marketing.nav.privacy') },
        { href: '/legal/cookie', label: t('marketing.nav.cookies') },
        { href: '/legal/sub-processors', label: t('marketing.nav.subProcessors') },
      ],
    },
  ]

  return (
    <footer className="mt-auto border-t border-stroke-subtle bg-surface-elevated text-on-surface">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-12 md:grid-cols-4">
        {columns.map((column) => (
          <div key={column.title}>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-on-surface">{column.title}</h2>
            <ul className="space-y-3">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-on-surface-variant transition-colors hover:text-light-signal-orange">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            {column.title === t('marketing.footer.legal') && (
              <div className="mt-3">
                <CookiePreferencesButton />
              </div>
            )}
          </div>
        ))}

        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/90">
            {t('marketing.footer.language')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <MarketingLanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl border-t border-stroke-subtle px-6 py-4 text-xs text-on-surface-variant">
        © {year} Utraya. {t('marketing.footer.rights')}
      </div>
    </footer>
  )
}
