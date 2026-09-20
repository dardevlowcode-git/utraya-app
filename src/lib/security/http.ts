/* Commento didattico:
 * Scopo del file: centralizza utilita` HTTP di sicurezza per request ID, IP e policy CSRF minimale.
 * Moduli richiamati: `node:crypto`, `@/lib/utils/errors`
 * Flusso: Le route API usano queste funzioni prima delle mutazioni per validare headers e origine.
 */

import { randomUUID } from 'node:crypto'
import { AppError } from '@/lib/utils/errors'

export function getRequestId(request: Request): string {
  const headerId = request.headers.get('x-request-id')?.trim()
  return headerId && headerId.length > 0 ? headerId : randomUUID()
}

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const candidate = forwarded.split(',')[0]?.trim()
    if (candidate) return candidate
  }

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
