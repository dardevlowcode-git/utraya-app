/* Commento didattico:
 * Scopo del file: cron giornaliero che completa i fetch trascrizione lasciati pending dall'import video.
 * Moduli richiamati: `node:crypto`, `zod`, service video-transcripts, helper API/security.
 * Flusso: valida Bearer CRON_SECRET, processa N pending e restituisce solo conteggi (mai il testo).
 */

import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { processPendingTranscripts } from '@/lib/services/video-transcripts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const QuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) })

export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const secret = process.env.CRON_SECRET
  if (!secret) return apiErr('CRON_MISCONFIGURED', 'CRON_SECRET mancante', 500, requestId)
  const received = Buffer.from(request.headers.get('authorization') ?? '', 'utf8')
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  const authorized = received.length === expected.length && timingSafeEqual(received, expected)
  if (!authorized) return apiErr('CRON_UNAUTHORIZED', 'Unauthorized', 401, requestId)
  const parsed = QuerySchema.safeParse({ limit: new URL(request.url).searchParams.get('limit') ?? undefined })
  if (!parsed.success) return apiErr('VALIDATION_FAILED', 'Parametro limit non valido', 400, requestId)
  try {
    return apiOk(await processPendingTranscripts(parsed.data.limit), requestId)
  } catch (error) {
    return apiErr('INTERNAL_ERROR', error instanceof Error ? error.message : 'Errore cron transcripts', 500, requestId)
  }
}
