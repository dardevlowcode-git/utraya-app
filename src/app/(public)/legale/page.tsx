/* Commento didattico:
 * Scopo del file: alias pubblico "Legale" verso la sezione legale canonica.
 * Moduli richiamati: `next/navigation`
 * Flusso: reindirizza in modo permanente verso `/legal/termini`.
 */

import { redirect } from 'next/navigation'

export default function LegaleAliasPage() {
  redirect('/legal/termini')
}
