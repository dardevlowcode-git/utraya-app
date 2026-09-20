/* Commento didattico:
 * Scopo del file: pagina legale Privacy Policy con rendering markdown da sorgente canonica.
 * Moduli richiamati: `@/lib/legal/documents`, `@/components/legal/LegalMarkdownDocument`.
 * Flusso: carica documento privacy dal markdown versionato e lo rende staticamente.
 */

import LegalMarkdownDocument from '@/components/legal/LegalMarkdownDocument'
import { loadLegalDocument } from '@/lib/legal/documents'

export const dynamic = 'force-static'
export const revalidate = 604800

export default async function PrivacyPage() {
  const document = await loadLegalDocument('privacy')
  return <LegalMarkdownDocument {...document} />
}