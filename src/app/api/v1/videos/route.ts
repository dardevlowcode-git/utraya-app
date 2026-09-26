/* Commento didattico:
 * Scopo del file: espone lista video e mutazioni di stato utente tramite API REST Bearer.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/videos`, `@/lib/services/channels`.
 * Flusso: applica filtri bounded, delega ownership e restituisce view model senza row o transcript interni.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { after } from 'next/server'
import { apiV1Error, apiV1Validation, getApiRequestId, readApiJson, requireApiJson, requireApiRateLimit, requireApiUser } from '@/lib/http/apiV1'
import { queueChannelScan } from '@/lib/services/channel-scan-actions'
import {
  getVideosForUser,
  setVideoSeenStatusForUser,
  setVideoWatchlistForUser,
} from '@/lib/services/videos'
import { toVideoListApiView } from '@/lib/view-models/videoApi'
import { z } from 'zod'

type VideoBody = {
  action?: 'import_channel' | 'set_seen_status' | 'set_watchlist'
  channelId?: string
  maxResults?: number
  videoId?: string
  seenStatus?: 'seen' | 'unseen' | 'hidden'
  inWatchlist?: boolean
}

const videoBodySchema = z.object({
  action: z.enum(['import_channel', 'set_seen_status', 'set_watchlist']).optional(),
  channelId: z.string().uuid().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
  videoId: z.string().uuid().optional(),
  seenStatus: z.enum(['seen', 'unseen', 'hidden']).optional(),
  inWatchlist: z.boolean().optional(),
}).strict()
const videoQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  analysisStatus: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  seenStatus: z.enum(['seen', 'unseen', 'hidden']).optional(),
  onlyWatchlist: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
  languageCode: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
}).strict()

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const url = new URL(request.url)
    const parsedQuery = videoQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsedQuery.success) return apiV1Validation('Parametri query non validi', requestId)
    const query = parsedQuery.data
    const data = await getVideosForUser({
      userId: current.user.id,
      channelId: query.channelId,
      analysisStatus: query.analysisStatus,
      seenStatus: query.seenStatus,
      onlyWatchlist: query.onlyWatchlist === 'true',
      search: query.search,
      languageCode: query.languageCode ?? 'it',
      limit: query.limit,
      page: query.page,
      supabase: current.supabase,
    })
    return apiOk(toVideoListApiView(data), requestId)
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
    const limited = requireApiRateLimit(requestId, { key: `v1:videos:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<VideoBody>(request, videoBodySchema)

    if ((body.action ?? 'import_channel') === 'import_channel') {
      if (!body.channelId?.trim()) return apiV1Validation('channelId obbligatorio', requestId)
      const scan = await queueChannelScan({ userId: current.user.id, channelId: body.channelId.trim(), supabase: current.supabase, source: 'import_channel', maxResults: body.maxResults, dedupeKey: request.headers.get('idempotency-key') ?? undefined })
      if (scan.background) after(() => { void scan.background?.() })
      return apiOk({ jobId: scan.jobId, deduplicated: scan.deduplicated }, requestId, 202)
    }

    if (!body.videoId?.trim()) return apiV1Validation('videoId obbligatorio', requestId)
    if (body.action === 'set_seen_status') {
      if (!body.seenStatus) return apiV1Validation('seenStatus obbligatorio', requestId)
      return apiOk(await setVideoSeenStatusForUser({ ...body, userId: current.user.id, videoId: body.videoId.trim(), supabase: current.supabase, seenStatus: body.seenStatus }), requestId)
    }
    if (body.action === 'set_watchlist' && typeof body.inWatchlist === 'boolean') {
      return apiOk(await setVideoWatchlistForUser({ userId: current.user.id, videoId: body.videoId.trim(), inWatchlist: body.inWatchlist, supabase: current.supabase }), requestId)
    }
    return apiV1Validation('Azione video non supportata', requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
