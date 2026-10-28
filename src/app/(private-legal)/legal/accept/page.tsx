import { getCurrentSession } from '@/lib/auth/provider'
import { getLegalAcceptanceStatus } from '@/lib/services/legal-acceptance'
import { redirect } from 'next/navigation'
import LegalAcceptanceClient from './LegalAcceptanceClient'

export default async function LegalAcceptPage() {
  const session = await getCurrentSession()
  if (!session) {
    redirect('/login')
  }

  const locale = session.preferredLanguage === 'en' ? 'en' : 'it'
  const status = await getLegalAcceptanceStatus(session.userId, locale)

  if (!status.needsAcceptance) {
    redirect('/dashboard')
  }

  return <LegalAcceptanceClient status={status} />
}