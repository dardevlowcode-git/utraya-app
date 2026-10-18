/* Commento didattico:
 * Scopo del file: espone le operazioni admin per leggere e salvare il profilo di trascrizione.
 * Moduli richiamati: Zod, sessione admin, envelope HTTP, protezioni same-origin e service transcription-profile.
 * Flusso: valida il payload Zod, autentica l'admin e delega validazioni di dominio, persistenza e audit al service.
 */

import { z } from 'zod'
import { getAdminSession } from '@/lib/auth/admin'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError } from '@/lib/utils/errors'
import {
  MODEL_NAME_PATTERN,
  getTranscriptionProfile,
  isValidPrice,
  listGeminiModels,
  updateTranscriptionProfile,
} from '@/lib/services/transcription-profile'

const priceSchema = z.number().refine(isValidPrice, 'Prezzo non valido')
const bodySchema = z.object({
  model: z.string().regex(MODEL_NAME_PATTERN),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']),
  inputPricePerMillion: priceSchema,
  outputPricePerMillion: priceSchema,
}).strict()

export async function GET(request: Request) {
  const requestId = getRequestId(request)
  if (!(await getAdminSession())) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)

  try {
    const admin = createAdminClient()
    const [profile, models] = await Promise.all([getTranscriptionProfile(admin), listGeminiModels(admin)])
    return apiOk({ profile, models }, requestId)
  } catch {
    return apiErr('INTERNAL_ERROR', 'Impossibile caricare il profilo di trascrizione', 500, requestId)
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const session = await getAdminSession()
    if (!session) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return apiErr('VALIDATION_FAILED', 'Profilo di trascrizione non valido', 400, requestId)

    const result = await updateTranscriptionProfile(createAdminClient(), parsed.data, session.username)
    if (result.ok) return apiOk(result.profile, requestId)
    if (result.code === 'INVALID_LEVEL') {
      return apiErr('VALIDATION_FAILED', 'Livello di ragionamento non valido per questo modello', 400, requestId)
    }
    if (result.code === 'MODELS_UNAVAILABLE') {
      return apiErr('VALIDATION_FAILED', 'Elenco modelli non disponibile: il modello non può essere cambiato', 409, requestId)
    }
    return apiErr('VALIDATION_FAILED', 'Modello non presente nell’elenco di Google', 400, requestId)
  } catch (error) {
    if (error instanceof AppError && error.type === 'forbidden') return apiErr('FORBIDDEN', 'Richiesta non consentita', 403, requestId)
    if (error instanceof AppError && error.type === 'validation') return apiErr('VALIDATION_FAILED', 'Richiesta non valida', 400, requestId)
    return apiErr('INTERNAL_ERROR', 'Impossibile salvare il profilo di trascrizione', 500, requestId)
  }
}
