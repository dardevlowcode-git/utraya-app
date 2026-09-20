/* Commento didattico:
 * Scopo del file: alias pubblico "Progetto" che converte vecchi link verso la pagina mission.
 * Moduli richiamati: `next/navigation`
 * Flusso: reindirizza in modo permanente verso la route canonica marketing `/mission`.
 */

import { redirect } from 'next/navigation'

export default function ProgettoAliasPage() {
  redirect('/mission')
}
