/* Commento didattico:
 * Scopo del file: espone stato e gestione delle chiavi provider senza mai restituire segreti in chiaro.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/integrations`.
 * Flusso: Bearer user + RLS delimitano la riga; il service cifra, valida e maschera la chiave.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1Validation, getApiRequestId, readApiJson, requireApiJson, requireApiRateLimit, requireApiUser } from '@/lib/http/apiV1'
import { getCredentialStatusesForUser, removeApiKey, saveApiKey, validateApiKey } from '@/lib/services/integrations'
import { toIntegrationApiView } from '@/lib/view-models/integrationApi'
import { z } from 'zod'

type IntegrationBody = { action?: 'save' | 'validate'; provider?: 'youtube' | 'gemini'; apiKey?: string }
const integrationSchema = z.object({
  action: z.enum(['save', 'validate']).optional(),
  provider: z.enum(['youtube', 'gemini']),
  apiKey: z.string().trim().max(4096).optional(),
}).strict()

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
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:integrations:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<IntegrationBody>(request, integrationSchema)
    if (!body.provider) return apiV1Validation('provider obbligatorio', requestId)
    if (body.action === 'validate') {
      const result = await validateApiKey({ userId: current.user.id, provider: body.provider, supabase: current.supabase })
      return apiOk({ provider: result.provider, isValid: result.isValid, validationError: result.isValid ? null : 'provider_validation_failed' }, requestId)
    }
    if (!body.apiKey?.trim()) return apiV1Validation('apiKey obbligatoria', requestId)
    const result = await saveApiKey({ userId: current.user.id, provider: body.provider, apiKey: body.apiKey, validateNow: true, supabase: current.supabase })
    return apiOk({ provider: result.provider, maskedKey: result.maskedKey, isValid: result.isValid, validationError: result.isValid === false ? 'provider_validation_failed' : null }, requestId)
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
    const limited = requireApiRateLimit(requestId, { key: `v1:integrations:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<IntegrationBody>(request, integrationSchema)
    if (!body.provider) return apiV1Validation('provider obbligatorio', requestId)
    await removeApiKey({ userId: current.user.id, provider: body.provider, supabase: current.supabase })
    return apiOk({ removed: true, provider: body.provider }, requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
