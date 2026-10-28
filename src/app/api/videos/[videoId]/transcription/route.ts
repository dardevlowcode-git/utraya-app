// Il callback di after() deve restituire la Promise del worker (ADR-014).

import { after } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/getCurrentUser'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { mapAppErrorTypeToCode, type ErrorCode } from '@/lib/http/errorCodes'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import {
  getTranscriptionViewModel,
  loadFollowedVideo,
  requestTranscriptionForUser,
  runTranscriptionJobNow,
} from '@/lib/services/transcription-requests'
import { AppError } from '@/lib/utils/errors'

export const runtime = 'nodejs'
export const maxDuration = 300

const paramsSchema = z.object({ videoId: z.string().uuid() })
const bodySchema = z.object({}).strict()
const STABLE_CODES = new Set<ErrorCode>(['GEMINI_KEY_REQUIRED', 'TRANSCRIPTION_UNAVAILABLE'])

/** Errori stabili e sanificati: i dettagli interni (context.cause) non escono mai. */
function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    const code = error.context?.code as ErrorCode | undefined
    const status = error.statusCode ?? 500
    return apiErr(code && STABLE_CODES.has(code) ? code : mapAppErrorTypeToCode(error.type), error.message, status, requestId)
  }
  return apiErr('INTERNAL_ERROR', 'Errore interno', 500, requestId)
}

/** Avvia la trascrizione su richiesta con la chiave Gemini personale di chi richiede. */
export async function POST(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const params = paramsSchema.safeParse(await context.params)
    const body = bodySchema.safeParse(await request.json().catch(() => null))
    if (!params.success || !body.success) return apiErr('VALIDATION_FAILED', 'Richiesta non valida', 400, requestId)
    const current = await getCurrentUser()
    if (!current) return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)

    const result = await requestTranscriptionForUser({
      supabase: current.supabase,
      userId: current.user.id,
      videoId: params.data.videoId,
    })
    const jobId = result.jobId
    // after() riceve la Promise del worker, altrimenti il runtime può interromperlo (ADR-014).
    if (jobId && result.shouldRun) after(() => runTranscriptionJobNow(jobId))
    return apiOk({ jobId, status: result.transcriptionStatus, reused: result.reused }, requestId, result.reused ? 200 : 202)
  } catch (error) {
    return errorResponse(error, requestId)
  }
}

/** Stato corrente (e frasi quando disponibili) per il polling della pagina video. */
export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const requestId = getRequestId(request)
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) return apiErr('VALIDATION_FAILED', 'Richiesta non valida', 400, requestId)
    const current = await getCurrentUser()
    if (!current) return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)

    const video = await loadFollowedVideo({ supabase: current.supabase, userId: current.user.id, videoId: params.data.videoId })
    const view = await getTranscriptionViewModel({ supabase: current.supabase, userId: current.user.id, video })
    return apiOk(view, requestId)
  } catch (error) {
    return errorResponse(error, requestId)
  }
}
