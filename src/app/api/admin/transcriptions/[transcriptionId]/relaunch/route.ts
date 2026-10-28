import { after } from 'next/server'
import { z } from 'zod'
import { getAdminSession } from '@/lib/auth/admin'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import { createAdminClient } from '@/lib/supabase/admin'
import { relaunchMissingParts } from '@/lib/services/admin-transcriptions'
import { runTranscriptionJobAndChain } from '@/lib/services/transcription-auto'
import { AppError } from '@/lib/utils/errors'

export const runtime = 'nodejs'
export const maxDuration = 300

const paramsSchema = z.object({ transcriptionId: z.string().uuid() })
const bodySchema = z.object({ partPosition: z.number().int().min(0).max(100_000).optional() }).strict()

export async function POST(request: Request, context: { params: Promise<{ transcriptionId: string }> }) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const session = await getAdminSession()
    if (!session) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)
    const params = paramsSchema.safeParse(await context.params)
    const body = bodySchema.safeParse(await request.json().catch(() => null))
    if (!params.success || !body.success) return apiErr('VALIDATION_FAILED', 'Richiesta non valida', 400, requestId)

    const result = await relaunchMissingParts(createAdminClient(), {
      transcriptionId: params.data.transcriptionId,
      partPosition: body.data.partPosition ?? null,
      adminUsername: session.username,
    })
    if (result.status === 'not_found') return apiErr('NOT_FOUND', 'Trascrizione non trovata', 404, requestId)
    if (result.status === 'no_missing') return apiErr('VALIDATION_FAILED', 'Nessuna parte mancante da rilanciare', 409, requestId)
    if (result.status === 'busy') return apiErr('VALIDATION_FAILED', 'Trascrizione in lavorazione: riprova più tardi', 409, requestId)

    const { jobId } = result
    // after() riceve la Promise del worker, altrimenti il runtime può interromperlo (ADR-014).
    after(() => runTranscriptionJobAndChain(jobId))
    return apiOk({ jobId, partsReset: result.partsReset, credentialMode: result.credentialMode }, requestId, 202)
  } catch (error) {
    if (error instanceof AppError && error.type === 'forbidden') return apiErr('FORBIDDEN', 'Richiesta non consentita', 403, requestId)
    if (error instanceof AppError && error.type === 'validation') return apiErr('VALIDATION_FAILED', 'Richiesta non valida', 400, requestId)
    return apiErr('INTERNAL_ERROR', 'Impossibile rilanciare le parti mancanti', 500, requestId)
  }
}
