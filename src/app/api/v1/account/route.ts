/* Commento didattico:
 * Scopo del file: espone stato e richiesta di cancellazione account per client Bearer.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/account-deletion`.
 * Flusso: il token identifica l'utente; il service applica grace period e idempotenza sulla richiesta pendente.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, getApiRequestId, readApiJson, requireApiJson, requireApiRateLimit, requireApiUser } from '@/lib/http/apiV1'
import { getClientIp } from '@/lib/security/http'
import { getDeletionRequestView, requestDeletion } from '@/lib/services/account-deletion'
import { z } from 'zod'

const deletionSchema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict()

export async function GET(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    return apiOk(await getDeletionRequestView(current.user.id), requestId)
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
    const limited = requireApiRateLimit(requestId, { key: `v1:account:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<{ reason?: string | null }>(request, deletionSchema)
    const result = await requestDeletion({
      userId: current.user.id,
      userEmail: current.user.email ?? '',
      reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null,
      ipAddress: getClientIp(request),
       userAgent: request.headers.get('user-agent'),
       requestId,
       cancelPath: '/api/v1/account/cancel-deletion',
     })
    // cancelToken e` la via preferita (POST body); cancelUrl resta per compatibilita`
    // con i client che seguono il link legacy e va trattato come segreto monouso.
    return apiOk({ scheduledFor: result.scheduledFor, cancelUrl: result.cancelUrl, cancelToken: result.cancelToken }, requestId, 202)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
