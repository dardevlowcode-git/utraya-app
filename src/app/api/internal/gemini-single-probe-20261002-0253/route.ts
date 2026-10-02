/* Commento didattico:
 * Scopo: route temporanea per UNA sola prova Gemini con persistenza canonica nel progetto Vercel DEV isolato.
 * Moduli richiamati: envelope HTTP, request-id e runner single-probe server-side.
 * Flusso: autorizza solo DEV + token temporaneo, esegue la mono-prova idempotente e mappa esito/diagnostica.
 */

import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import {
  claimSingleProbeInThisRuntime,
  executeGeminiSingleProbe,
  isSingleProbeAuthorized,
  isSingleProbeDevDeployment,
} from '@/lib/services/gemini-single-probe-20261002-0253'

export const runtime = 'nodejs'
export const maxDuration = 60

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request)
  if (!isSingleProbeDevDeployment()) {
    return noStore(apiErr('FORBIDDEN', 'Probe disponibile solo sul deployment DEV', 403, requestId))
  }
  if (!isSingleProbeAuthorized(request)) {
    return noStore(apiErr('UNAUTHORIZED', 'Probe non autorizzato', 401, requestId))
  }
  if (!claimSingleProbeInThisRuntime()) {
    return noStore(apiErr('RATE_LIMITED', 'Prova già avviata in questo runtime', 429, requestId))
  }
  const result = await executeGeminiSingleProbe()
  if (result.ok) return noStore(apiOk(result, requestId))
  const status =
    result.failure === 'eligible_video_unavailable'
      ? 404
      : result.failure === 'single_probe_already_claimed'
        ? 429
        : 502
  const code = status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR'
  const response = apiErr(code, 'La singola prova Gemini non è stata completata.', status, requestId)
  response.headers.set('X-Probe-Failure', result.failure)
  if (Number.isInteger(result.httpStatus) && result.httpStatus !== null && result.httpStatus >= 100 && result.httpStatus <= 599) {
    response.headers.set('X-Upstream-Status', String(result.httpStatus))
  }
  return noStore(response)
}
