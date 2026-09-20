/* Commento didattico:
 * Scopo del file: alias pubblico "Cookie Policy" verso il percorso legale canonico.
 * Moduli richiamati: `next/navigation`
 * Flusso: reindirizza in modo permanente verso `/legal/cookie`.
 */

import { redirect } from 'next/navigation'

export default function CookiePolicyAliasPage() {
  redirect('/legal/cookie')
}
