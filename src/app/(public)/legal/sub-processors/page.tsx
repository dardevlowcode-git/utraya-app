/* Commento didattico:
 * Scopo del file: pagina pubblica sub-processors/DPA con estrazione sezioni condivisibili dal documento completo.
 * Moduli richiamati: `@/lib/legal/documents`, `@/components/legal/LegalMarkdownDocument`.
 * Flusso: isola sezioni DPA pubblicabili (2,3,4,7) e le espone come pagina legale statica.
 */

import LegalMarkdownDocument from '@/components/legal/LegalMarkdownDocument'
import { loadDpaPublicMarkdown } from '@/lib/legal/documents'

export const dynamic = 'force-static'
export const revalidate = 604800

export default async function SubProcessorsPage() {
  const document = await loadDpaPublicMarkdown()
  return <LegalMarkdownDocument {...document} />
}