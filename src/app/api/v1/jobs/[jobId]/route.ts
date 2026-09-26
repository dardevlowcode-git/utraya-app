/* Commento didattico:
 * Scopo del file: permette al client mobile di interrogare solo job creati dall'utente autenticato.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/http/apiResponse`.
 * Flusso: RLS + filtro created_by_user_id delimitano ownership; payload e dettagli interni non escono.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1Validation, getApiRequestId, requireApiUser } from '@/lib/http/apiV1'
import { getUserJobStatus } from '@/lib/services/user-jobs'
import { z } from 'zod'

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const { jobId } = await context.params
    const parsedJobId = z.string().uuid().safeParse(jobId)
    if (!parsedJobId.success) return apiV1Validation('jobId non valido', requestId)
    return apiOk(await getUserJobStatus({ userId: current.user.id, jobId: parsedJobId.data, supabase: current.supabase }), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
