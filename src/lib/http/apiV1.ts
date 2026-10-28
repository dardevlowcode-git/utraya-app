import { getApiUser, type ApiUserContext } from '@/lib/auth/apiUser'
import { apiErr } from '@/lib/http/apiResponse'
import { mapAppErrorTypeToCode, type ErrorCode } from '@/lib/http/errorCodes'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { ensureJsonRequest, getRequestId } from '@/lib/security/http'
import { AppError } from '@/lib/utils/errors'
import { z } from 'zod'

/** Codici errore che la API v1 restituisce letteralmente al client, oltre al mapping per tipo. */
const STABLE_V1_ERROR_CODES = new Set<ErrorCode>(['TOS_ACCEPTANCE_REQUIRED'])

export function getApiRequestId(request: Request): string {
  return getRequestId(request)
}

export async function requireApiUser(request: Request, requestId: string): Promise<ApiUserContext | Response> {
  const user = await getApiUser(request)
  return user ?? apiErr('UNAUTHORIZED', 'Token Bearer non valido o mancante', 401, requestId)
}

export function requireApiJson(request: Request): void {
  ensureJsonRequest(request)
}

export async function readApiJson<T>(request: Request, schema?: z.ZodType<T>): Promise<T> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new AppError('JSON non valido', 'validation', 400)
  }
  if (!schema) return value as T
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new AppError('Payload non valido', 'validation', 400)
  return parsed.data
}

export function apiV1Error(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    const status = error.statusCode ?? 500
    const code = error.context?.code as ErrorCode | undefined
    const message = error.type === 'temporary'
      ? 'Operazione temporaneamente non disponibile'
      : status >= 500
        ? 'Errore interno'
        : error.message
    // Codici stabili esposti al client (es. consenso TOS mancante) restano quelli dichiarati dal service.
    if (code && STABLE_V1_ERROR_CODES.has(code)) return apiErr(code, message, status, requestId)
    return apiErr(mapAppErrorTypeToCode(error.type, 'UPSTREAM_ERROR'), message, status, requestId)
  }

  return apiErr('INTERNAL_ERROR', 'Errore interno', 500, requestId)
}

export function apiV1Validation(message: string, requestId: string): Response {
  return apiErr('VALIDATION_FAILED', message, 400, requestId)
}

// Applica il rate limiting in-memory alla chiave indicata.
// Restituisce una risposta 429 con header Retry-After quando la soglia e`
// superata, altrimenti null e la route prosegue normalmente.
export function requireApiRateLimit(
  requestId: string,
  options: { key: string; limit?: number; windowMs?: number }
): Response | null {
  const decision = checkRateLimit(options.key, options.limit ?? 60, options.windowMs ?? 60_000)
  if (decision.allowed) return null
  const response = apiErr('RATE_LIMITED', 'Troppe richieste, riprova più tardi', 429, requestId)
  response.headers.set('Retry-After', String(Math.max(Math.ceil(decision.resetAfterMs / 1000), 1)))
  return response
}

export function apiV1NotFound(message: string, requestId: string): Response {
  return apiErr('NOT_FOUND', message, 404, requestId)
}
