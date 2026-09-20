/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `next/server`, `@/lib/auth/admin`
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { NextResponse } from 'next/server'
import { adminSessionCookieName } from '@/lib/auth/admin'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'

/**
 * Invalida la sessione admin azzerando il cookie dedicato.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }

  // Logout admin: si invalida il cookie impostando scadenza immediata (maxAge: 0).
  const response = NextResponse.json({ ok: true, requestId })
  response.cookies.set({
    name: adminSessionCookieName,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })

  return response
}
