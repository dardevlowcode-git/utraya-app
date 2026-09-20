/* Commento didattico:
 * Scopo del file: contiene un componente di interfaccia per la struttura visiva (navigazione, footer, sidebar).
 * Moduli richiamati: `next/link`, `next-intl/server`
 * Flusso: Il componente riceve dati da pagine/layout parent, usa eventuali hook/utilita` e restituisce markup riusabile.
 */

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function Footer() {
  const t = await getTranslations()
  const year = new Date().getFullYear()

  return (
    <footer className="bg-surface-container-low w-full py-6 mt-auto">
      <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-xs text-on-surface-variant">
          © {year} Utraya. {t('landing.footer.copyright')}
        </p>
        <div className="flex gap-6">
          {[
            { href: '/privacy', label: t('landing.footer.privacy') },
            { href: '/termini', label: t('landing.footer.terms') },
            { href: '/contatto', label: t('landing.footer.contact') },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  )
}
