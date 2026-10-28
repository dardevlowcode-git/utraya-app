// Non applicare il controllo TOS qui: causerebbe un loop sulla pagina di accettazione.

import Footer from '@/components/layout/Footer'
import PrivateChrome from '@/components/layout/PrivateChrome'
import { getCurrentSession } from '@/lib/auth/provider'
import { redirect } from 'next/navigation'

export default async function PrivateLegalLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <PrivateChrome session={session} footer={<Footer />}>
      {children}
    </PrivateChrome>
  )
}
