/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `@/lib/auth/provider`, `@/lib/services/videos`, `@/lib/utils/errors`
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { getCurrentSession } from '@/lib/auth/provider'
import {
  getVideosForUser,
  importChannelVideos,
  setVideoSeenStatusForUser,
  setVideoWatchlistForUser,
} from '@/lib/services/videos'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'

interface VideosPostBody {
  action?: 'import_channel' | 'set_seen_status' | 'set_watchlist'
  channelId?: string
  maxResults?: number
  videoId?: string
  seenStatus?: 'seen' | 'unseen' | 'hidden'
  inWatchlist?: boolean
}

/**
 * Converte query string booleana in valore boolean.
 */
function parseBoolean(value: string | null): boolean {
  // Supporta sia true/false sia 1/0 per compatibilita con client diversi.
  return value === 'true' || value === '1'
}

/**
 * Estrae userId dalla sessione o lancia errore 401.
 */
function requireUserId(userId: string | null | undefined): string {
  if (!userId) {
    throw new AppError('Sessione non valida', 'unauthorized', 401)
  }
  return userId
}

/**
 * Restituisce lista video con filtri, stato utente e paginazione.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)

    const { searchParams } = new URL(request.url)

    const channelId = searchParams.get('channelId') ?? undefined
    const analysisStatus = (searchParams.get('analysisStatus') as
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | null) ?? undefined

    const seenStatus = (searchParams.get('seenStatus') as 'seen' | 'unseen' | 'hidden' | null) ?? undefined

    const onlyWatchlist = parseBoolean(searchParams.get('onlyWatchlist'))
    const search = searchParams.get('search') ?? undefined
    const languageCode = searchParams.get('languageCode') ?? session?.preferredLanguage ?? 'it'

    const limitParam = searchParams.get('limit')
    const pageParam = searchParams.get('page')

    const limit = limitParam ? Number(limitParam) : undefined
    const page = pageParam ? Number(pageParam) : undefined

    // Delega filtri/paginazione al service, mantenendo il route handler sottile.
    const data = await getVideosForUser({
      userId,
      channelId,
      analysisStatus,
      seenStatus,
      onlyWatchlist,
      search,
      languageCode,
      limit,
      page,
    })

    return Response.json({ data, error: null, errorType: null })
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500)
    }
    return errorResponse('Errore interno', 'unknown', 500)
  }
}

/**
 * Avvia import video da canale per l'utente autenticato.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)

    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)

    const body = (await request.json().catch(() => null)) as VideosPostBody | null
    const action = body?.action ?? 'import_channel'

    if (action === 'import_channel') {
      const channelId = body?.channelId?.trim()
      if (!channelId) {
        return errorResponse('channelId mancante', 'validation', 400, requestId)
      }

      const maxResults = typeof body?.maxResults === 'number' ? body.maxResults : undefined

      // Import da canale YouTube: il service gestisce API esterna e upsert video.
      const result = await importChannelVideos({
        userId,
        channelId,
        maxResults,
      })

      return Response.json({
        data: {
          ...result,
          message: 'Import canale completato',
        },
        error: null,
        errorType: null,
        errorCode: null,
        requestId,
      })
    }

    if (action === 'set_seen_status') {
      const videoId = body?.videoId?.trim()
      const seenStatus = body?.seenStatus

      if (!videoId || (seenStatus !== 'seen' && seenStatus !== 'unseen' && seenStatus !== 'hidden')) {
        return errorResponse('Parametri aggiornamento stato visto non validi', 'validation', 400, requestId)
      }

      const result = await setVideoSeenStatusForUser({ userId, videoId, seenStatus })

      return Response.json({
        data: result,
        error: null,
        errorType: null,
        errorCode: null,
        requestId,
      })
    }

    if (action === 'set_watchlist') {
      const videoId = body?.videoId?.trim()
      const inWatchlist = body?.inWatchlist

      if (!videoId || typeof inWatchlist !== 'boolean') {
        return errorResponse('Parametri watchlist non validi', 'validation', 400, requestId)
      }

      const result = await setVideoWatchlistForUser({ userId, videoId, inWatchlist })

      return Response.json({
        data: result,
        error: null,
        errorType: null,
        errorCode: null,
        requestId,
      })
    }

    return errorResponse('Azione non supportata', 'validation', 400, requestId)
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }
}
