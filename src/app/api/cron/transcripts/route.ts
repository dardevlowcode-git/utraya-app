/* Commento didattico:
 * Scopo del file: cron giornaliero che completa i fetch trascrizione lasciati pending dall'import video.
 * Moduli richiamati: `node:crypto`, `zod`, service video-transcripts, helper API/security.
 * Flusso: valida Bearer CRON_SECRET, rispetta cron_settings (enabled/batch_limit),
 * processa i pending e restituisce solo conteggi (mai il testo).
 */

import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTranscriptSettings } from '@/lib/services/cron-settings'
import {
  processPendingTranscripts,
  runTranscriptFixture,
  TranscriptFixtureCleanupError,
} from '@/lib/services/video-transcripts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FIXTURE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  fixture_video_id: z.string().regex(FIXTURE_VIDEO_ID).optional(),
})

function fixtureCleanupFailed(requestId: string): Response {
  const response = Response.json({
    ok: false,
    error: {
      code: 'FIXTURE_CLEANUP_FAILED',
      message: 'Fixture cleanup failed; manual intervention may be required.',
    },
    requestId,
  }, { status: 500 })
  response.headers.set('X-Request-Id', requestId)
  response.headers.set('X-Transcript-Fixture-Cleanup', 'failed')
  return response
}

function isAuthorizedFixture(videoId: string): boolean {
  const configuredVideoId = process.env.TRANSCRIPT_E2E_VIDEO_ID
  return process.env.NEXT_PUBLIC_SITE_URL === 'https://dev.utraya.com'
    && process.env.VERCEL_GIT_COMMIT_REF === 'dev'
    && Boolean(configuredVideoId && FIXTURE_VIDEO_ID.test(configuredVideoId))
    && videoId === configuredVideoId
}

export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const secret = process.env.CRON_SECRET
  if (!secret) return apiErr('CRON_MISCONFIGURED', 'CRON_SECRET mancante', 500, requestId)
  const received = Buffer.from(request.headers.get('authorization') ?? '', 'utf8')
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  const authorized = received.length === expected.length && timingSafeEqual(received, expected)
  if (!authorized) return apiErr('CRON_UNAUTHORIZED', 'Unauthorized', 401, requestId)
  const searchParams = new URL(request.url).searchParams
  const allowedParams = new Set(['limit', 'fixture_video_id'])
  if ([...searchParams.keys()].some((key) => !allowedParams.has(key))) {
    return apiErr('VALIDATION_FAILED', 'Parametri non validi', 400, requestId)
  }
  if (searchParams.getAll('limit').length > 1 || searchParams.getAll('fixture_video_id').length > 1) {
    return apiErr('VALIDATION_FAILED', 'Parametri duplicati', 400, requestId)
  }
  const fixtureVideoId = searchParams.get('fixture_video_id') ?? undefined
  const parsed = QuerySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    fixture_video_id: fixtureVideoId,
  })
  if (!parsed.success) return apiErr('VALIDATION_FAILED', 'Parametro limit non valido', 400, requestId)
  if (fixtureVideoId && parsed.data.limit !== 1) {
    return apiErr('VALIDATION_FAILED', 'La fixture richiede limit=1', 400, requestId)
  }
  if (fixtureVideoId && !isAuthorizedFixture(fixtureVideoId)) {
    return apiErr('FORBIDDEN', 'Fixture disponibile solo per il video DEV autorizzato', 403, requestId)
  }
  try {
    const settings = await getTranscriptSettings(createAdminClient())
    if (!settings.enabled) return apiOk({ skipped: true, reason: 'disabled' }, requestId)
    if (fixtureVideoId) {
      return apiOk(await runTranscriptFixture(fixtureVideoId, fetch, { requestId }), requestId)
    }
    const limit = Math.min(parsed.data.limit, settings.batch_limit)
    return apiOk(await processPendingTranscripts(limit, fetch, { requestId }), requestId)
  } catch (error) {
    if (fixtureVideoId && error instanceof TranscriptFixtureCleanupError) {
      return fixtureCleanupFailed(requestId)
    }
    if (fixtureVideoId) {
      return apiErr('INTERNAL_ERROR', 'Fixture transcript run failed; cleanup was attempted.', 500, requestId)
    }
    return apiErr('INTERNAL_ERROR', error instanceof Error ? error.message : 'Errore cron transcripts', 500, requestId)
  }
}
