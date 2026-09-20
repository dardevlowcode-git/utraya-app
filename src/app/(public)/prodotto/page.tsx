/* Commento didattico:
 * Scopo del file: alias pubblico "Prodotto" che mantiene compatibilita` con link legacy verso la landing.
 * Moduli richiamati: `next/navigation`
 * Flusso: reindirizza in modo permanente verso la route canonica marketing `/`.
 */

import { redirect } from 'next/navigation'

export default function ProdottoAliasPage() {
  redirect('/')
}
