import LegalMarkdownDocument from '@/components/legal/LegalMarkdownDocument'
import { loadDpaPublicMarkdown } from '@/lib/legal/documents'

export const dynamic = 'force-static'
export const revalidate = 604800

export default async function SubProcessorsPage() {
  const document = await loadDpaPublicMarkdown()
  return <LegalMarkdownDocument {...document} />
}