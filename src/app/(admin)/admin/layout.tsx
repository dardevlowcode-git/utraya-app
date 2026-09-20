/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `@/components/layout/TopNav`, `@/components/layout/AdminSideNav`, `@/components/layout/Footer`, `@/lib/auth/admin`, `next/navigation`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import TopNav from '@/components/layout/TopNav'
import AdminSideNav from '@/components/layout/AdminSideNav'
import Footer from '@/components/layout/Footer'
import { getAdminSession } from '@/lib/auth/admin'
import { redirect } from 'next/navigation'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const adminSession = await getAdminSession()
  if (!adminSession) {
    redirect('/admin/login')
  }

  const session = {
    userId: `admin:${adminSession.username}`,
    email: adminSession.username,
    displayName: adminSession.username,
    avatarUrl: null,
    role: 'super_admin' as const,
    preferredLanguage: 'it',
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      <TopNav variant="admin" session={session} />
      <div className="flex flex-1 pt-16">
        <AdminSideNav />
        <main className="flex-1 ml-64 min-h-full">
          {children}
        </main>
      </div>
      <div className="ml-64">
        <Footer />
      </div>
    </div>
  )
}
