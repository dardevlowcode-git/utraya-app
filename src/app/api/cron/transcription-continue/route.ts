/* Commento didattico:
 * Scopo del file: continuazione interna dei job di trascrizione rilasciati dopo il budget di durata, senza cron al minuto.
 * Moduli richiamati: `next/server` (`after`), servizi di trascrizione, confronto a tempo costante di CRON_SECRET.
 * Flusso: il worker che termina il budget chiama questa route; qui si risponde 202 subito e il job riprende in `after()`.
 */

import { after } from 'next/server'
import { z } from 'zod'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { runTranscriptionJobNow } from '@/lib/services/transcription-requests'
import { isAuthorizedCronRequest } from '@/lib/services/transcription-store'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({ jobId: z.string().uuid() }).strict()

/** Riprende un job di trascrizione pending o con lease scaduta; il claim atomico evita doppie esecuzioni. */
export async function POST(request: Request) {
  const requestId = getRequestId(request)
  if (!process.env.CRON_SECRET) return apiErr('CRON_MISCONFIGURED', 'Errore interno', 500, requestId)
  if (!isAuthorizedCronRequest(request)) return apiErr('CRON_UNAUTHORIZED', 'Non autorizzato', 401, requestId)

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return apiErr('VALIDATION_FAILED', 'Richiesta non valida', 400, requestId)

  const { jobId } = body.data
  // after() riceve la Promise del worker (ADR-014).
  after(() => runTranscriptionJobNow(jobId))
  return apiOk({ accepted: true }, requestId, 202)
}
