/* Commento didattico:
 * Scopo del file: legge lo stato pubblico di un job creato dall'utente senza esporre payload o diagnostica interna.
 * Moduli richiamati: `@/lib/supabase/types`, `@/lib/supabase/server`, `@/lib/utils/errors`.
 * Flusso: il client request-scoped applica RLS e filtro ownership; il service restituisce solo campi di lifecycle.
 */

import { createClient } from '@/lib/supabase/server'
import type { AppSupabaseClient } from '@/lib/supabase/types'
import { AppError } from '@/lib/utils/errors'

export async function getUserJobStatus(params: {
  userId: string
  jobId: string
  supabase?: AppSupabaseClient
}) {
  const supabase = params.supabase ?? await createClient()
  const { data, error } = await supabase
    .from('jobs')
    .select('id, job_type, status, created_at, started_at, completed_at')
    .eq('id', params.jobId)
    .eq('created_by_user_id', params.userId)
    .maybeSingle()
  if (error) throw new AppError('Impossibile leggere lo stato job', 'unknown', 500, { cause: error.message })
  if (!data) throw new AppError('Job non trovato', 'not_found', 404)

  return {
    id: data.id,
    type: data.job_type,
    status: data.status,
    createdAt: data.created_at,
    startedAt: data.started_at,
    completedAt: data.completed_at,
  }
}
