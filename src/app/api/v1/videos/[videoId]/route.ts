/* Commento didattico:
 * Scopo del file: restituisce il dettaglio di un video solo se il canale è seguito dall'utente Bearer.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/videos`.
 * Flusso: autentica, applica ownership nel service e serializza il contesto video pubblico.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1NotFound, apiV1Validation, getApiRequestId, requireApiUser } from '@/lib/http/apiV1'
import { getVideoForUser } from '@/lib/services/videos'
import { toVideoApiView } from '@/lib/view-models/videoApi'
import { z } from 'zod'

export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const { videoId } = await context.params
    const languageCodeParam = new URL(request.url).searchParams.get('languageCode')
    const languageCode = languageCodeParam === null ? 'it' : z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).safeParse(languageCodeParam)
    const parsedVideoId = z.string().uuid().safeParse(videoId)
    if (!parsedVideoId.success || (typeof languageCode !== 'string' && !languageCode.success)) return apiV1Validation('Parametri video non validi', requestId)
    const video = await getVideoForUser({ userId: current.user.id, videoId: parsedVideoId.data, languageCode: typeof languageCode === 'string' ? languageCode : languageCode.data, supabase: current.supabase })
    if (!video) return apiV1NotFound('Video non trovato', requestId)
    return apiOk(toVideoApiView(video), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
