/* Commento didattico:
 * Scopo del file: pagina impostazioni account con richiesta cancellazione, stato grace period e annullamento via token.
 * Moduli richiamati: auth provider, service account deletion, client component locale.
 * Flusso: carica stato cancellazione server-side e delega interazioni mutative al componente client.
 */

import { redirect } from 'next/navigation'
import { getCurrentSession } from '@/lib/auth/provider'
import { getDeletionRequestView } from '@/lib/services/account-deletion'
import AccountDeletionClient from './AccountDeletionClient'

export default async function AccountSettingsPage() {
  const session = await getCurrentSession()

  if (!session) {
    redirect('/login')
  }

  const deletion = await getDeletionRequestView(session.userId)

  return (
    <div className="px-6 pb-20 pt-14">
      <div className="mx-auto max-w-3xl rounded-3xl bg-surface-container-low p-8 shadow-ambient">
        <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">Impostazioni account</h1>
        <p className="mt-2 text-sm text-on-surface-variant">Gestisci la cancellazione account con grace period di 30 giorni.</p>
        <AccountDeletionClient initialState={deletion} />
      </div>
    </div>
  )
}