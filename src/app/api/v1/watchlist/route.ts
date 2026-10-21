/* Commento didattico:
 * Scopo del file: espone lettura e modifica della watchlist default per il client mobile.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/watchlist`, `@/lib/services/videos`.
 * Flusso: ogni operazione è legata al Bearer user e non accetta watchlistId di un altro utente.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1Validation, getApiRequestId, readApiJson, requireApiJson, requireApiRateLimit, requireApiUser } from '@/lib/http/apiV1'
import { setVideoWatchlistForUser } from '@/lib/services/videos'
import { getWatchlistForUser, removeVideoFromWatchlist } from '@/lib/services/watchlist'
import { z } from 'zod'

const videoReferenceSchema = z.object({ videoId: z.string().uuid() }).strict()

export async function GET(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    return apiOk(await getWatchlistForUser(current.user.id, current.supabase), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}

export async function POST(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    requireApiJson(request)
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:watchlist:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<{ videoId: string }>(request, videoReferenceSchema)
    if (!body.videoId?.trim()) return apiV1Validation('videoId obbligatorio', requestId)
    return apiOk(await setVideoWatchlistForUser({ userId: current.user.id, videoId: body.videoId.trim(), inWatchlist: true, supabase: current.supabase }), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}

export async function DELETE(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    requireApiJson(request)
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:watchlist:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<{ videoId: string }>(request, videoReferenceSchema)
    if (!body.videoId?.trim()) return apiV1Validation('videoId obbligatorio', requestId)
    return apiOk(await removeVideoFromWatchlist({ userId: current.user.id, videoId: body.videoId.trim(), supabase: current.supabase }), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
