/* Commento didattico:
 * Scopo del file: espone le operazioni admin per consultare e salvare limiti retry delle chiavi.
 * Moduli richiamati: Zod, sessione admin, envelope HTTP, protezioni same-origin e service retry-limits.
 * Flusso: valida il payload Zod, autentica l'admin e delega la persistenza al service server-only.
 */

import { z } from 'zod'
import { getAdminSession } from '@/lib/auth/admin'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminRetryLimits, setCredentialRetryLimit, setSharedYoutubeRetryLimit } from '@/lib/services/retry-limits'
import { RETRY_LIMIT_MAX } from '@/lib/utils/retry-limit'

const retryLimitSchema = z.number().int().min(0).max(RETRY_LIMIT_MAX)
const bodySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('credential'), credentialId: z.string().uuid(), retryLimit: retryLimitSchema }).strict(),
  z.object({ scope: z.literal('shared-youtube'), retryLimit: retryLimitSchema }).strict(),
])

export async function GET(request: Request) {
  const requestId = getRequestId(request)
  if (!(await getAdminSession())) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)

  try {
    return apiOk(await getAdminRetryLimits(createAdminClient()), requestId)
  } catch {
    return apiErr('INTERNAL_ERROR', 'Impossibile caricare i limiti retry', 500, requestId)
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return apiErr('VALIDATION_FAILED', 'Payload retry limit non valido', 400, requestId)
    if (!(await getAdminSession())) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)

    const admin = createAdminClient()
    const result = parsed.data.scope === 'credential'
      ? await setCredentialRetryLimit(admin, parsed.data.credentialId, parsed.data.retryLimit)
      : await setSharedYoutubeRetryLimit(admin, parsed.data.retryLimit)
    if (!result) return apiErr('NOT_FOUND', 'Credenziale non trovata', 404, requestId)
    return apiOk({ ...result, maxAttempts: result.retryLimit + 1 }, requestId)
  } catch {
    return apiErr('INTERNAL_ERROR', 'Impossibile salvare il limite retry', 500, requestId)
  }
}
