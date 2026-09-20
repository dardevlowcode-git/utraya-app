/* Commento didattico:
 * Scopo del file: pagina autenticata per doppia accettazione TOS/clausole vessatorie prima accesso dashboard.
 * Moduli richiamati: auth provider, service legal acceptance e client form.
 * Flusso: calcola stato accettazioni mancanti lato server e delega submit al componente client.
 */

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