/* Commento didattico:
 * Scopo del file: pagina legale Termini di Servizio con rendering markdown da sorgente canonica.
 * Moduli richiamati: `@/lib/legal/documents`, `@/components/legal/LegalMarkdownDocument`.
 * Flusso: carica documento TOS dal file markdown e lo rende staticamente con metadata visibili.
 */

import LegalMarkdownDocument from '@/components/legal/LegalMarkdownDocument'
import { loadLegalDocument } from '@/lib/legal/documents'

export const dynamic = 'force-static'
export const revalidate = 604800

export default async function TermsPage() {
  const document = await loadLegalDocument('tos')
  return <LegalMarkdownDocument {...document} />
}