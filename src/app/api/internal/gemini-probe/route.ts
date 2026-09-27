/* Commento didattico:
 * Scopo: route temporanea per una sola prova Gemini nel progetto Vercel DEV isolato.
 * Moduli richiamati: apiResponse, request ID e probe server-only.
 * Flusso: limita al branch DEV, autentica con token temporaneo, legge la chiave del solo profilo autorizzato lato server e non salva il risultato.
 */

import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import {
  claimGeminiProbeInThisRuntime,
  executeGeminiProfileProbe,
  isGeminiProbeAuthorized,
  isGeminiProbeDevDeployment,
} from '@/lib/services/gemini-probe'

export const runtime = 'nodejs'
export const maxDuration = 300

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: Request) {
  const requestId = getRequestId(request)
  if (!isGeminiProbeDevDeployment()) return noStore(apiErr('FORBIDDEN', 'Probe disponibile solo sul deployment DEV', 403, requestId))
  if (!isGeminiProbeAuthorized(request)) return noStore(apiErr('UNAUTHORIZED', 'Probe non autorizzato', 401, requestId))
  if (!claimGeminiProbeInThisRuntime()) return noStore(apiErr('RATE_LIMITED', 'Probe già invocato in questo runtime', 429, requestId))
  const result = await executeGeminiProfileProbe()
  if ('failure' in result) {
    const message = result.failure === 'profile_unavailable'
      ? 'Profilo Gemini DEV non disponibile'
      : 'La chiamata Gemini non è stata completata'
    const status = result.failure === 'profile_unavailable' ? 503 : 502
    return noStore(apiErr('UPSTREAM_ERROR', message, status, requestId))
  }
  if (!result.ok) {
    const failure = apiErr('UPSTREAM_ERROR', 'La chiamata Gemini non è stata completata', 502, requestId)
    if (Number.isInteger(result.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599) {
      failure.headers.set('X-Upstream-Status', String(result.httpStatus))
    }
    const errorCode = String(result.providerErrorCode ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)
    if (errorCode) failure.headers.set('X-Upstream-Error-Code', errorCode)
    return noStore(failure)
  }
  return noStore(apiOk(result, requestId))
}
