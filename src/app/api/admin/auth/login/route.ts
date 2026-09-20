/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `next/server`
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { NextResponse } from 'next/server'
import {
  adminSessionCookieName,
  buildAdminSessionCookieValue,
  getAdminSessionMaxAge,
  verifySuperAdminCredentials,
} from '@/lib/auth/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getClientIp, getRequestId } from '@/lib/security/http'

interface LoginBody {
  username?: string
  password?: string
}

const maxAttemptsPerWindow = 5
const rateLimitWindowMinutes = 15

async function countRecentFailedAttempts(params: {
  ipAddress: string | null
  username: string
  sinceIso: string
}): Promise<{ byIp: number; byUsername: number }> {
  const admin = createAdminClient()

  const byIpQuery = params.ipAddress
    ? admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'admin_login_failed')
      .eq('ip_address', params.ipAddress)
      .gte('created_at', params.sinceIso)
    : Promise.resolve({ count: 0, error: null } as const)

  const byUsernameQuery = admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'admin_login_failed')
    .eq('resource_id', params.username)
    .gte('created_at', params.sinceIso)

  const [byIp, byUsername] = await Promise.all([byIpQuery, byUsernameQuery])
  if (byIp.error) throw new AppError('Errore controllo rate limit', 'unknown', 500)
  if (byUsername.error) throw new AppError('Errore controllo rate limit', 'unknown', 500)

  return {
    byIp: byIp.count ?? 0,
    byUsername: byUsername.count ?? 0,
  }
}

async function writeAdminLoginAudit(params: {
  requestId: string
  username: string
  ipAddress: string | null
  action: 'admin_login_failed' | 'admin_login_success' | 'admin_login_rate_limited'
}) {
  const admin = createAdminClient()
  await admin.from('audit_logs').insert({
    user_id: null,
    action: params.action,
    resource_type: 'admin_auth',
    resource_id: params.username,
    ip_address: params.ipAddress,
    details: {
      username: params.username,
      request_id: params.requestId,
    },
  })
}

/**
 * Esegue login super-admin e imposta cookie sessione HttpOnly firmato.
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

  // Parsing difensivo: evita eccezioni runtime se il client invia JSON non valido.
  let body: LoginBody
  try {
    body = (await request.json()) as LoginBody
  } catch {
    return errorResponse('Body richiesta non valido', 'validation', 400, requestId)
  }

  const username = body.username?.trim() ?? ''
  const password = body.password ?? ''
  const ipAddress = getClientIp(request)

  if (!username || !password) {
    return errorResponse('Username e password obbligatori', 'validation', 400, requestId)
  }

  const now = new Date()
  const sinceIso = new Date(now.getTime() - rateLimitWindowMinutes * 60_000).toISOString()

  try {
    const attempts = await countRecentFailedAttempts({ ipAddress, username, sinceIso })
    if (attempts.byIp >= maxAttemptsPerWindow || attempts.byUsername >= maxAttemptsPerWindow) {
      await writeAdminLoginAudit({
        requestId,
        username,
        ipAddress,
        action: 'admin_login_rate_limited',
      })

      return errorResponse('Troppi tentativi, riprova più tardi', 'forbidden', 429, requestId)
    }
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }

  // Verifica credenziali tramite modulo centralizzato (`lib/auth/admin.ts`).
  const isValid = verifySuperAdminCredentials(username, password)
  if (!isValid) {
    await writeAdminLoginAudit({
      requestId,
      username,
      ipAddress,
      action: 'admin_login_failed',
    })
    return errorResponse('Credenziali non valide', 'unauthorized', 401, requestId)
  }

  await writeAdminLoginAudit({
    requestId,
    username,
    ipAddress,
    action: 'admin_login_success',
  })

  // Se valido, emette cookie HttpOnly firmato usato poi dal middleware su `/admin/*`.
  const response = NextResponse.json({ ok: true, requestId })
  response.cookies.set({
    name: adminSessionCookieName,
    value: buildAdminSessionCookieValue(username),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: getAdminSessionMaxAge(),
  })

  return response
}
