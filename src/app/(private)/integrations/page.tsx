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
