/* Commento didattico:
 * Scopo del file: layout autenticato per la sola pagina `/legal/accept`, senza enforcement TOS per evitare loop.
 * Moduli richiamati: componenti layout e auth provider.
 * Flusso: richiede sessione utente e rende shell privata standard per la pagina di accettazione legale.
 */

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
