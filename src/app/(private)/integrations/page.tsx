/* Commento didattico:
 * Scopo del file: definisce una pagina o layout protetto: viene usato dopo l'autenticazione dell'utente.
 * Moduli richiamati: `next`, `@/lib/auth/provider`, `@/lib/services/integrations`, `./IntegrationsClient`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { getCurrentSession } from '@/lib/auth/provider'
import { getCredentialStatusesForUser } from '@/lib/services/integrations'
import IntegrationsClient from './IntegrationsClient'

export const metadata: Metadata = {
  title: 'Integrazioni',
  description: 'Configura le tue chiavi API YouTube e Gemini.',
}

export default async function IntegrationsPage() {
  const session = await getCurrentSession()
  const statuses = session ? await getCredentialStatusesForUser(session.userId) : []

  return <IntegrationsClient initialStatuses={statuses} />
}
