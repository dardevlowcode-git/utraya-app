import type { Metadata } from 'next'
import AdminRetryLimitsClient from '@/components/admin/AdminRetryLimitsClient'
import { getAdminRetryLimits } from '@/lib/services/retry-limits'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Admin — Limiti retry' }

export default async function AdminRetryLimitsPage() {
  const retryLimits = await getAdminRetryLimits(createAdminClient())
  return <AdminRetryLimitsClient initialRetryLimits={retryLimits} />
}
