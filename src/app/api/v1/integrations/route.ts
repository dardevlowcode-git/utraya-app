/* Commento didattico:
 * Scopo del file: espone stato e gestione delle chiavi provider senza mai restituire segreti in chiaro.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/integrations`, `@/lib/types/domain`.
 * Flusso: Bearer user + RLS delimitano la riga; il service cifra, accoda la verifica e maschera la chiave.
 */

import { after } from 'next/server'
import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1Validation, getApiRequestId, readApiJson, requireApiJson, requireApiRateLimit, requireApiUser } from '@/lib/http/apiV1'
import { getCredentialStatusesForUser, removeApiKey, runCredentialValidationJob, saveApiKey, validateApiKey } from '@/lib/services/integrations'
import { AppError } from '@/lib/utils/errors'
import { toIntegrationApiView } from '@/lib/view-models/integrationApi'
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from '@/lib/types/domain'
import { z } from 'zod'

const integrationSchema = z.object({
  action: z.enum(['save', 'validate']).optional(),
  provider: z.enum(INTEGRATION_PROVIDERS),
  apiKey: z.string().trim().max(4096).optional(),
}).strict()
const integrationDeleteSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
}).strict()
export const maxDuration = 60

type IntegrationBody = z.infer<typeof integrationSchema>
type IntegrationDeleteBody = z.infer<typeof integrationDeleteSchema>

type AsyncIntegrationResult = {
  provider: IntegrationProvider
  jobId: string
  maskedKey?: string
  isValid: boolean | null
  validationStatus: 'idle' | 'pending' | 'running' | 'completed'
}

/** Lavora il job nello stesso lifecycle: after() riceve la Promise del worker (ADR-014). */
function scheduleValidation(jobId: string | null, validationStatus: string): void {
  if (jobId && validationStatus === 'pending') after(() => runCredentialValidationJob(jobId))
}

/** Proietta l'esito asincrono nel contratto v1, mantenendo solo la chiave già mascherata. */
function asyncIntegrationResponse(
  result: AsyncIntegrationResult,
  requestId: string,
  validationError: string | null
): Response {
  return apiOk({
    provider: result.provider,
    jobId: result.jobId,
    ...(result.maskedKey === undefined ? {} : { maskedKey: result.maskedKey }),
    isValid: result.isValid,
    validationStatus: result.validationStatus,
    validationError,
  }, requestId, 202)
}

export async function GET(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const statuses = await getCredentialStatusesForUser(current.user.id, current.supabase)
    return apiOk(statuses.map(toIntegrationApiView), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}

export async function POST(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    requireApiJson(request)
    const body = await readApiJson<IntegrationBody>(request, integrationSchema)
    if (body.action !== 'validate' && !body.apiKey?.trim()) return apiV1Validation('apiKey obbligatoria', requestId)
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:integrations:${current.user.id}` })
    if (limited) return limited
    if (body.action === 'validate') {
      const result = await validateApiKey({ userId: current.user.id, provider: body.provider, supabase: current.supabase })
      scheduleValidation(result.jobId, result.validationStatus)
      const validationError = result.validationStatus === 'pending' || result.validationStatus === 'running'
        ? null
        : result.isValid ? null : 'provider_validation_failed'
      return asyncIntegrationResponse(result, requestId, validationError)
    }
    const result = await saveApiKey({ userId: current.user.id, provider: body.provider, apiKey: body.apiKey ?? '', validateNow: true, supabase: current.supabase })
    const jobId = result.jobId
    if (!jobId) throw new AppError('Job di validazione non accodato', 'structural', 500)
    scheduleValidation(jobId, result.validationStatus)
    const validationError = result.validationStatus === 'pending' || result.validationStatus === 'running'
      ? null
      : result.isValid === false ? 'provider_validation_failed' : null
    return asyncIntegrationResponse({ ...result, jobId }, requestId, validationError)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}

export async function DELETE(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    requireApiJson(request)
    const body = await readApiJson<IntegrationDeleteBody>(request, integrationDeleteSchema)
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:integrations:${current.user.id}` })
    if (limited) return limited
    await removeApiKey({ userId: current.user.id, provider: body.provider, supabase: current.supabase })
    return apiOk({ removed: true, provider: body.provider }, requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
