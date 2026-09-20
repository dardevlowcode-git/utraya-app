/* Commento didattico:
 * Scopo del file: definisce una pagina o layout protetto: viene usato dopo l'autenticazione dell'utente.
 * Moduli richiamati: `next`, `@/lib/auth/provider`, `@/lib/services/channels`, `./ChannelsClient`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { getCurrentSession } from '@/lib/auth/provider'
import { getChannelsForUser } from '@/lib/services/channels'
import ChannelsClient from './ChannelsClient'

export const metadata: Metadata = {
  title: 'Canali',
  description: 'Gestisci i canali YouTube che segui su Utraya.',
}

export default async function ChannelsPage() {
  const session = await getCurrentSession()
  const userChannels = session ? await getChannelsForUser(session.userId) : []

  return <ChannelsClient initialChannels={userChannels} />
}
