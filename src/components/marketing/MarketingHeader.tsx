/* Commento didattico:
 * Scopo del file: header del marketing site con pill navigation, lingua e CTA principale.
 * Moduli richiamati: `next/link`, `next-intl/server`, `./LanguageSwitcher`
 * Flusso: il componente server risolve le traduzioni e rende il menu pubblico coerente su tutte le pagine marketing.
 */

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import MarketingLanguageSwitcher from './LanguageSwitcher'
import ThemeToggle from '@/components/theme/ThemeToggle'

export default async function MarketingHeader() {
  const t = await getTranslations()

  const navLinks = [
    { href: '/funzionalita', label: t('marketing.nav.features') },
    { href: '/prezzi', label: t('marketing.nav.pricing') },
    { href: '/faq', label: t('marketing.nav.faq') },
  ]

  return (
    <header className="shell-header sticky top-0 z-50">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-6">
        <Link href="/" className="shell-logo">
          UTRAYA
        </Link>

        <nav
          aria-label={t('marketing.nav.label')}
          className="shell-nav-pill hidden items-center gap-2 md:flex"
        >
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shell-nav-link"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <MarketingLanguageSwitcher />
            <ThemeToggle />
          </div>
          <Link
            href="/login"
            className="shell-cta-default hidden sm:inline-flex"
          >
            {t('marketing.cta.createWatchlist')}
          </Link>
        </div>
      </div>
    </header>
  )
}
