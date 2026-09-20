/* Commento didattico:
 * Scopo del file: centralizza envelope HTTP standard `{ ok, data/error, requestId }` per nuove route API.
 * Moduli richiamati: `./errorCodes`.
 * Flusso: route handler invoca `apiOk`/`apiErr` per risposte uniformi e header `X-Request-Id` coerente.
 */

import type { ErrorCode } from './errorCodes'

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set('X-Request-Id', requestId)
  return response
}

export function apiOk<T>(data: T, requestId: string, status = 200): Response {
  return withRequestId(Response.json({ ok: true, data, requestId }, { status }), requestId)
}

export function apiErr(code: ErrorCode, message: string, status: number, requestId: string): Response {
  return withRequestId(
    Response.json({ ok: false, error: { code, message, requestId } }, { status }),
    requestId
  )
}