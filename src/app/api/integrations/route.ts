import { after } from 'next/server'
import { getCurrentSession } from '@/lib/auth/provider'
import {
  getCredentialStatusesForUser,
  removeApiKey,
  runCredentialValidationJob,
  saveApiKey,
  validateApiKey,
} from '@/lib/services/integrations'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { mapAppErrorTypeToCode, type ErrorCode } from '@/lib/http/errorCodes'
import { AppError } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import { INTEGRATION_PROVIDERS } from '@/lib/types/domain'
import { z } from 'zod'

export const maxDuration = 60

const providerSchema = z.enum(INTEGRATION_PROVIDERS)
const integrationPostSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().optional(),
  action: z.enum(['save', 'validate']).optional(),
}).strict()
const integrationDeleteSchema = z.object({ provider: providerSchema }).strict()

/**
 * Estrae userId dalla sessione o lancia errore 401 coerente per tutte le azioni.
 */
function requireUserId(userId: string | null | undefined): string {
  // Verifica minima richiesta da tutte le azioni integrazioni.
  if (!userId) {
    throw new AppError('Sessione non valida', 'unauthorized', 401)
  }
  return userId
}

/** Applica l'envelope e la sanitizzazione standard a tutti gli errori del BFF. */
function integrationErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    const code = error.context?.code as ErrorCode | undefined
    if (code === 'TOS_ACCEPTANCE_REQUIRED') {
      return apiErr(code, error.message, error.statusCode ?? 403, requestId)
    }
    return apiErr(mapAppErrorTypeToCode(error.type), error.message, error.statusCode ?? 500, requestId)
  }
  return apiErr('INTERNAL_ERROR', 'Errore interno', 500, requestId)
}

/** Lavora il job nello stesso lifecycle: after() riceve la Promise del worker (ADR-014). */
function scheduleValidation(result: { jobId: string | null; validationStatus: string }): void {
  const jobId = result.jobId
  if (jobId && result.validationStatus === 'pending') after(() => runCredentialValidationJob(jobId))
}

/**
 * Restituisce stato integrazioni (configured/valid/masked) dell'utente.
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request)
  try {
    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)

    // Restituisce solo stato/masking chiavi: mai la chiave in chiaro.
    const statuses = await getCredentialStatusesForUser(userId)
    return apiOk(statuses, requestId)
  } catch (error) {
    return integrationErrorResponse(error, requestId)
  }
}

/**
 * Gestisce salvataggio o validazione di una chiave provider.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const parsed = integrationPostSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return apiErr('VALIDATION_FAILED', 'Payload integrazione non valido', 400, requestId)
    const { provider, action, apiKey } = parsed.data
    if (action !== 'validate' && !apiKey) return apiErr('VALIDATION_FAILED', 'apiKey mancante', 400, requestId)

    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)

    if (action === 'validate') {
      // Validazione esplicita: utile quando la chiave e gia salvata e si vuole ricontrollare.
      const result = await validateApiKey({ userId, provider })
      if (!result.jobId) throw new AppError('Job di validazione non accodato', 'structural', 500)
      scheduleValidation(result)
      return apiOk(result, requestId, 202)
    }

    // Salvataggio e accodamento della verifica persistente e lavoro immediato via after().
    const result = await saveApiKey({
      userId,
      provider,
      apiKey: apiKey ?? '',
      validateNow: true,
    })

    if (!result.jobId) throw new AppError('Job di validazione non accodato', 'structural', 500)
    scheduleValidation(result)
    return apiOk(result, requestId, 202)
  } catch (error) {
    return integrationErrorResponse(error, requestId)
  }
}

/**
 * Rimuove logicamente la chiave provider dell'utente.
 */
export async function DELETE(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const parsed = integrationDeleteSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return apiErr('VALIDATION_FAILED', 'Payload integrazione non valido', 400, requestId)

    const session = await getCurrentSession()
    const userId = requireUserId(session?.userId)
    const { provider } = parsed.data

    await removeApiKey({ userId, provider })

    return apiOk({ message: 'Chiave rimossa correttamente' }, requestId)
  } catch (error) {
    return integrationErrorResponse(error, requestId)
  }
}
