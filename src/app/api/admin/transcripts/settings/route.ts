/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `zod`, `@/lib/auth/admin`, `@/lib/http/apiResponse`, service cron-settings.
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { z } from 'zod'
import { getAdminSession } from '@/lib/auth/admin'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getTranscriptSettings,
  getTranscriptStats,
  updateTranscriptSettings,
} from '@/lib/services/cron-settings'

const BodySchema = z.object({ enabled: z.boolean(), batch_limit: z.number().int().min(1).max(50) })

export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const adminSession = await getAdminSession()
  if (!adminSession) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)
  try {
    const admin = createAdminClient()
    const [settings, stats] = await Promise.all([getTranscriptSettings(admin), getTranscriptStats(admin)])
    return apiOk({ settings, stats }, requestId)
  } catch (error) {
    return apiErr('INTERNAL_ERROR', error instanceof Error ? error.message : 'Errore lettura impostazioni', 500, requestId)
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request)
  const adminSession = await getAdminSession()
  if (!adminSession) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const parsed = BodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return apiErr('VALIDATION_FAILED', 'Payload non valido: attesi enabled boolean e batch_limit intero 1-50', 400, requestId)
    const admin = createAdminClient()
    const settings = await updateTranscriptSettings(admin, parsed.data)
    return apiOk({ settings, stats: await getTranscriptStats(admin) }, requestId)
  } catch (error) {
    return apiErr('INTERNAL_ERROR', error instanceof Error ? error.message : 'Errore salvataggio impostazioni', 500, requestId)
  }
}
