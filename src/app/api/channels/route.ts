/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `@/lib/auth/provider`, `@/lib/utils/errors`
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { getCurrentSession } from '@/lib/auth/provider'
import {
  addChannelForUser,
  getChannelsForUser,
  removeChannelForUser,
  requestScanNowForUser,
} from '@/lib/services/channels'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'

interface ChannelPostBody {
  action?: 'add' | 'scan_now'
  channelUrl?: string
  channelId?: string
  markExistingVideosAsSeen?: boolean
}

interface ChannelDeleteBody {
  channelId?: string
}

/**
 * Estrae userId dalla sessione o lancia errore 401 coerente per tutta la route.
 */
function requireSessionUserId(userId: string | null | undefined): string {
  // Helper condiviso: centralizza l'errore 401 per tutte le azioni del file.
  if (!userId) {
    throw new AppError('Sessione non valida', 'unauthorized', 401)
  }
  return userId
}

/**
 * Ritorna l'elenco canali dell'utente autenticato.
 */
export async function GET() {
  try {
    const session = await getCurrentSession()
    const userId = requireSessionUserId(session?.userId)

    // Delega la logica dati al service (`lib/services/channels.ts`).
    const channels = await getChannelsForUser(userId)
    return Response.json({ data: channels, error: null, errorType: null })
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500)
    }
    return errorResponse('Errore interno', 'unknown', 500)
  }
}

/**
 * Gestisce azioni canale: `add` (default) e `scan_now`.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)

    const session = await getCurrentSession()
    const userId = requireSessionUserId(session?.userId)

    const body = (await request.json().catch(() => null)) as ChannelPostBody | null
    const action = body?.action ?? 'add'

    if (action === 'scan_now') {
      if (!body?.channelId) {
        return errorResponse('channelId mancante', 'validation', 400, requestId)
      }

      // Scansione manuale: crea un job asincrono senza bloccare la richiesta HTTP.
      const scanResult = await requestScanNowForUser({ userId, channelId: body.channelId })
      return Response.json({
        data: { message: 'Scansione avviata', ...scanResult },
        error: null,
        errorType: null,
        errorCode: null,
        requestId,
      })
    }

    const channelUrl = body?.channelUrl?.trim()
    if (!channelUrl) {
      return errorResponse('channelUrl mancante', 'validation', 400, requestId)
    }

    // Aggiunta canale: parsing URL + upsert + enqueue sync iniziale.
    const result = await addChannelForUser({
      userId,
      channelUrl,
      markExistingVideosAsSeen: body?.markExistingVideosAsSeen ?? true,
    })

    const warningCode = result.scanBlockedReason === 'missing_youtube_api_key'
      ? 'missing_youtube_api_key'
      : null

    return Response.json({
      data: {
        message: warningCode
          ? 'Canale aggiunto. Scansione in pausa: aggiungi una API key YouTube oppure attendi che un utente con key aggiunga lo stesso canale.'
          : result.initialScanError
          ? `Canale aggiunto. Scansione iniziale fallita: ${result.initialScanError}`
            : 'Canale aggiunto correttamente',
        warningCode,
        ...result,
      },
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

/**
 * Rimuove il canale dal profilo utente e pulisce i riferimenti collegati.
 */
export async function DELETE(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)

    const session = await getCurrentSession()
    const userId = requireSessionUserId(session?.userId)

    const body = (await request.json().catch(() => null)) as ChannelDeleteBody | null
    const channelId = body?.channelId?.trim()

    if (!channelId) {
      return errorResponse('channelId mancante', 'validation', 400, requestId)
    }

    const result = await removeChannelForUser({ userId, channelId })

    return Response.json({
      data: {
        message: result.alreadyRemoved ? 'Canale già rimosso' : 'Canale rimosso',
      },
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
