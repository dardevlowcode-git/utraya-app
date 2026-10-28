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
