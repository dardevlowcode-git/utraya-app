/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `@/lib/auth/admin`, `@/lib/http/apiResponse`, service video-transcripts/cron-settings.
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { getAdminSession } from '@/lib/auth/admin'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTranscriptSettings } from '@/lib/services/cron-settings'
import { processPendingTranscripts } from '@/lib/services/video-transcripts'

export async function POST(request: Request) {
  const requestId = getRequestId(request)
  const adminSession = await getAdminSession()
  if (!adminSession) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const settings = await getTranscriptSettings(createAdminClient())
    return apiOk(await processPendingTranscripts(settings.batch_limit), requestId)
  } catch (error) {
    return apiErr('INTERNAL_ERROR', error instanceof Error ? error.message : 'Errore esecuzione trascrizioni', 500, requestId)
  }
}
