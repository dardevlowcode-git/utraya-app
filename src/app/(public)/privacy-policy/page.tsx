/* Commento didattico:
 * Scopo del file: alias pubblico "Privacy Policy" verso il percorso legale canonico.
 * Moduli richiamati: `next/navigation`
 * Flusso: reindirizza in modo permanente verso `/legal/privacy`.
 */

import { redirect } from 'next/navigation'

export default function PrivacyPolicyAliasPage() {
  redirect('/legal/privacy')
}
