/* Commento didattico:
 * Scopo del file: endpoint manuale protetto (non schedulato in vercel.json) che avanza job persistenti di verifica credenziali; il recovery automatico è nel daily-sync.
 * Moduli richiamati: timingSafeEqual, service job validation e attempt provider same-key.
 * Flusso: valida CRON_SECRET e processa un batch tecnico di lease, una richiesta provider per lease.
 */

import { timingSafeEqual } from 'node:crypto'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { processPendingCredentialValidationJobs } from '@/lib/services/credential-validation-jobs'
import { performCredentialValidationAttempt } from '@/lib/services/integrations'

export const runtime = 'nodejs'
export const maxDuration = 30

/** Avanza job pending/due e recupera lease scadute senza azzerare i job_attempts. */
export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization') ?? ''
  const expected = secret ? `Bearer ${secret}` : ''
  const receivedBuffer = Buffer.from(authorization, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (!secret) return apiErr('CRON_MISCONFIGURED', 'CRON_SECRET mancante', 500, requestId)

  const authorized = receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer)

  if (!authorized) {
    return apiErr('CRON_UNAUTHORIZED', 'Unauthorized', 401, requestId)
  }

  try {
    const result = await processPendingCredentialValidationJobs({
      attemptProvider: performCredentialValidationAttempt,
    })
    return apiOk(result, requestId)
  } catch {
    return apiErr('INTERNAL_ERROR', 'Errore interno', 500, requestId)
  }
}
