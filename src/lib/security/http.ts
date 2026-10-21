/* Commento didattico:
 * Scopo del file: centralizza utilita` HTTP di sicurezza per request ID, IP e policy CSRF minimale.
 * Moduli richiamati: `node:crypto`, `@/lib/utils/errors`
 * Flusso: Le route API usano queste funzioni prima delle mutazioni per validare headers e origine.
 */

import { randomUUID } from 'node:crypto'
import { AppError } from '@/lib/utils/errors'

export function getRequestId(request: Request): string {
  const headerId = request.headers.get('x-request-id')?.trim()
  const isUuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(headerId ?? '')
  return isUuidV4 ? headerId! : randomUUID()
}

export function getClientIp(request: Request): string | null {
  // Non fidarti del primo elemento di X-Forwarded-For: il client puo`
  // pre-inserirlo. Vercel/proxy termina la catena in X-Real-IP.
  const realIp = request.headers.get('x-real-ip')?.trim()
  return realIp || null
}

export function ensureJsonRequest(request: Request): void {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    throw new AppError('Content-Type deve essere application/json', 'validation', 415)
  }
}

export function ensureSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  if (!origin) {
    throw new AppError('Origin header mancante', 'forbidden', 403)
  }

  const requestOrigin = new URL(request.url).origin
  if (origin !== requestOrigin) {
    throw new AppError('Origine richiesta non consentita', 'forbidden', 403)
  }
}
