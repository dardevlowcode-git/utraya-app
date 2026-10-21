/* Commento didattico:
 * Scopo del file: carica la vista non segreta dei limiti retry per la console amministrativa.
 * Moduli richiamati: client Supabase admin, service retry-limits e relativo editor client.
 * Flusso: la pagina protetta dall'AdminLayout legge i view model server-side e li passa all'editor.
 */

import type { Metadata } from 'next'
import AdminRetryLimitsClient from '@/components/admin/AdminRetryLimitsClient'
import { getAdminRetryLimits } from '@/lib/services/retry-limits'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Admin — Limiti retry' }

export default async function AdminRetryLimitsPage() {
  const retryLimits = await getAdminRetryLimits(createAdminClient())
  return <AdminRetryLimitsClient initialRetryLimits={retryLimits} />
}
