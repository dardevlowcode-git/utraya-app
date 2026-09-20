/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `@/lib/auth/provider`, `@/lib/utils/errors`
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { getCurrentSession } from '@/lib/auth/provider'
import {
  getCredentialStatusesForUser,
  removeApiKey,
  saveApiKey,
  validateApiKey,
} from '@/lib/services/integrations'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'

interface IntegrationPostBody {
  provider?: 'youtube' | 'gemini'
  apiKey?: string
  action?: 'save' | 'validate'
}

interface IntegrationDeleteBody {
  provider?: 'youtube' | 'gemini'
}

/**
 * Estrae userId dalla sessione o lancia errore 401 coerente per tutte le azioni.
 */
function requireUserId(userId: string | null | undefined): string {
  // Verifica minima richiesta da tutte le azioni integrazioni.
  if (!userId) {
    throw new AppError('Sessione non valida', 'unauthorized', 401)
  }
  return userId
}

/**
 * Restituisce stato integrazioni (configured/valid/masked) dell'utente.
 */
export async function GET() {
  try {
    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)

    // Restituisce solo stato/masking chiavi: mai la chiave in chiaro.
    const statuses = await getCredentialStatusesForUser(userId)

    return Response.json({
      data: statuses,
      error: null,
      errorType: null,
    })
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500)
    }
    return errorResponse('Errore interno', 'unknown', 500)
  }
}

/**
 * Gestisce salvataggio o validazione di una chiave provider.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)

    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)

    const body = (await request.json().catch(() => null)) as IntegrationPostBody | null
    const provider = body?.provider

    if (!provider) {
      return errorResponse('provider mancante', 'validation', 400, requestId)
    }

    if (body?.action === 'validate') {
      // Validazione esplicita: utile quando la chiave e gia salvata e si vuole ricontrollare.
      const result = await validateApiKey({ userId, provider })
      return Response.json({ data: result, error: null, errorType: null, errorCode: null, requestId })
    }

    const apiKey = body?.apiKey?.trim()
    if (!apiKey) {
      return errorResponse('apiKey mancante', 'validation', 400, requestId)
    }

    // Salvataggio e validazione immediata per feedback UX piu chiaro.
    const result = await saveApiKey({
      userId,
      provider,
      apiKey,
      validateNow: true,
    })

    return Response.json({ data: result, error: null, errorType: null, errorCode: null, requestId })
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }
}

/**
 * Rimuove logicamente la chiave provider dell'utente.
 */
export async function DELETE(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)

    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)

    const body = (await request.json().catch(() => null)) as IntegrationDeleteBody | null
    const provider = body?.provider

    if (!provider) {
      return errorResponse('provider mancante', 'validation', 400, requestId)
    }

    await removeApiKey({ userId, provider })

    return Response.json({
      data: { message: 'Chiave rimossa correttamente' },
      error: null,
      errorType: null,
      errorCode: null,
      requestId,
    })
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }
}
