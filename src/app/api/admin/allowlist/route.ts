/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `next/server`, `@/lib/supabase/admin`, `@/lib/auth/admin`
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminSession } from '@/lib/auth/admin'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getClientIp, getRequestId } from '@/lib/security/http'

interface AllowlistBody {
  email?: string
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Normalizza email per confronto/chiave univoca lato database.
 */
function normalizeEmail(value: string): string {
  // Normalizzazione unica per evitare duplicati (maiuscole/spazi) in DB.
  return value.trim().toLowerCase()
}

/**
 * Valida il formato base email lato API.
 */
function isValidEmail(value: string): boolean {
  return emailPattern.test(value)
}

/**
 * Aggiunge o riattiva una email in allowlist.
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

  // Protezione endpoint: solo super-admin con cookie valido puo autorizzare email.
  const adminSession = await getAdminSession()
  if (!adminSession) {
    return errorResponse('Unauthorized', 'unauthorized', 401, requestId)
  }

  const body = (await request.json().catch(() => null)) as AllowlistBody | null
  const email = normalizeEmail(body?.email ?? '')

  if (!email) {
    return errorResponse('Email richiesta', 'validation', 400, requestId)
  }

  if (!isValidEmail(email)) {
    return errorResponse('Email non valida', 'validation', 400, requestId)
  }

  const supabase = createAdminClient()
  // Upsert su email: stessa API copre sia "nuova autorizzazione" sia "riattivazione".
  const { error } = await supabase
    .from('allowlist_entries')
    .upsert({ email, is_active: true }, { onConflict: 'email' })

  if (error) {
    return errorResponse('Errore salvataggio allowlist', 'unknown', 500, requestId)
  }

  await supabase.from('audit_logs').insert({
    user_id: null,
    action: 'admin_allowlist_add',
    resource_type: 'allowlist',
    resource_id: email,
    ip_address: getClientIp(request),
    details: {
      admin_username: adminSession.username,
      request_id: requestId,
      email,
    },
  })

  return NextResponse.json({
    data: { message: 'Accesso autorizzato', email },
    error: null,
    errorType: null,
    errorCode: null,
    requestId,
  })
}

/**
 * Revoca una email dall'allowlist (soft revoke con `is_active=false`).
 */
export async function DELETE(request: Request) {
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

  // Revoca soft: non cancelliamo il record, impostiamo `is_active = false`.
  // In questo modo rimane lo storico e si puo riattivare in seguito.
  const adminSession = await getAdminSession()
  if (!adminSession) {
    return errorResponse('Unauthorized', 'unauthorized', 401, requestId)
  }

  const body = (await request.json().catch(() => null)) as AllowlistBody | null
  const email = normalizeEmail(body?.email ?? '')

  if (!email) {
    return errorResponse('Email richiesta', 'validation', 400, requestId)
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('allowlist_entries')
    .update({ is_active: false })
    .eq('email', email)

  if (error) {
    return errorResponse('Errore revoca allowlist', 'unknown', 500, requestId)
  }

  await supabase.from('audit_logs').insert({
    user_id: null,
    action: 'admin_allowlist_revoke',
    resource_type: 'allowlist',
    resource_id: email,
    ip_address: getClientIp(request),
    details: {
      admin_username: adminSession.username,
      request_id: requestId,
      email,
    },
  })

  return NextResponse.json({
    data: { message: 'Accesso revocato', email },
    error: null,
    errorType: null,
    errorCode: null,
    requestId,
  })
}
