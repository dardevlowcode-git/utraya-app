import { after } from 'next/server'
import { z } from 'zod'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { runTranscriptionJobAndChain } from '@/lib/services/transcription-auto'
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
  after(() => runTranscriptionJobAndChain(jobId))
  return apiOk({ accepted: true }, requestId, 202)
}
