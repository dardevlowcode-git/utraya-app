import Footer from '@/components/layout/Footer'
import PrivateChrome from '@/components/layout/PrivateChrome'
import { getCurrentSession } from '@/lib/auth/provider'
import { getLegalAcceptanceStatus } from '@/lib/services/legal-acceptance'
import { redirect } from 'next/navigation'

export default async function PrivateLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getCurrentSession()

  if (!session) {
    redirect('/login')
  }

  const locale = session.preferredLanguage === 'en' ? 'en' : 'it'
  const acceptanceStatus = await getLegalAcceptanceStatus(session.userId, locale)
  if (acceptanceStatus.needsAcceptance) {
    redirect('/legal/accept')
  }

  return (
    <PrivateChrome session={session} footer={<Footer />}>
      {children}
    </PrivateChrome>
  )
}
