import LegalMarkdownDocument from '@/components/legal/LegalMarkdownDocument'
import { loadLegalDocument } from '@/lib/legal/documents'

export const dynamic = 'force-static'
export const revalidate = 604800

export default async function PrivacyPage() {
  const document = await loadLegalDocument('privacy')
  return <LegalMarkdownDocument {...document} />
}