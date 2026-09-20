/* Commento didattico:
 * Scopo del file: alias pubblico "Termini di servizio" verso il percorso legale canonico.
 * Moduli richiamati: `next/navigation`
 * Flusso: reindirizza in modo permanente verso `/legal/termini`.
 */

import { redirect } from 'next/navigation'

export default function TerminiDiServizioAliasPage() {
  redirect('/legal/termini')
}
