/* Commento didattico:
 * Scopo del file: pagina admin delle trascrizioni da rivedere con filtro per stato, frequenza e rilancio parti mancanti.
 * Moduli richiamati: Zod per i parametri di query, client Supabase admin, service admin-transcriptions e client della pagina.
 * Flusso: la pagina protetta dall'AdminLayout valida `status` e `page`, legge elenco e statistiche e li passa alla UI.
 */

import type { Metadata } from 'next'
import { z } from 'zod'
import AdminTranscriptionsClient from '@/components/admin/AdminTranscriptionsClient'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ADMIN_DEFAULT_FILTER,
  ADMIN_TRANSCRIPTION_FILTERS,
  getAdminReviewStats,
  listAdminTranscriptions,
} from '@/lib/services/admin-transcriptions'

export const metadata: Metadata = { title: 'Admin — Trascrizioni' }

const querySchema = z.object({
  status: z.enum(ADMIN_TRANSCRIPTION_FILTERS as [string, ...string[]]).catch(ADMIN_DEFAULT_FILTER),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
})

export default async function AdminTranscriptionsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const query = querySchema.parse({
    status: Array.isArray(raw.status) ? raw.status[0] : raw.status,
    page: Array.isArray(raw.page) ? raw.page[0] : raw.page,
  })
  const admin = createAdminClient()
  const filter = query.status as (typeof ADMIN_TRANSCRIPTION_FILTERS)[number]
  const [list, stats] = await Promise.all([
    listAdminTranscriptions(admin, { filter, page: query.page }),
    getAdminReviewStats(admin),
  ])
  return (
    <AdminTranscriptionsClient
      filter={list.filter}
      filters={ADMIN_TRANSCRIPTION_FILTERS}
      page={list.page}
      pageCount={list.pageCount}
      total={list.total}
      items={list.items}
      stats={stats}
    />
  )
}
