/* Commento didattico:
 * Scopo: presenta i collegamenti di consultazione per una sezione del contenuto canonico.
 * Moduli richiamati: `next/link` e il view model della tabella admin.
 * Flusso: rende link per valori disponibili e placeholder non interattivi per quelli mancanti.
 */

import Link from 'next/link'
import type { AdminCanonicalContentLinkViewModel } from '@/lib/view-models/admin-canonical-content'

interface CanonicalContentCellProps {
  label: string
  items: AdminCanonicalContentLinkViewModel[]
}

/** Rende le lingue disponibili distinguendo i valori mancanti senza link. */
export default function CanonicalContentCell({ label, items }: CanonicalContentCellProps) {
  if (items.length === 0) return <span aria-label={`${label}: nessun dato`}>—</span>

  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item) => {
        const language = item.languageCode.toUpperCase()
        return (
          <li key={item.languageCode}>
            {item.href ? (
              <Link
                href={item.href}
                prefetch={false}
                aria-label={`${label} (${language})`}
                className="underline underline-offset-2 text-primary hover:text-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {language}
              </Link>
            ) : (
              <span>{language}: —</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
