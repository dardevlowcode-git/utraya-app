/* Commento didattico:
 * Scopo del file: annulla una cancellazione con token firmato entro il grace period.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/account-deletion`.
 * Flusso: il token è verificato server-side; non vengono accettati userId o requestId dal client.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiErr } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1Validation, getApiRequestId, readApiJson, requireApiJson } from '@/lib/http/apiV1'
import { cancelDeletion, getCancelDeletionTokenOwner } from '@/lib/services/account-deletion'
import { z } from 'zod'

const cancelSchema = z.object({ token: z.string().min(1).max(4096).optional() }).strict()

// Impedisce caching delle risposte su un flusso che trasporta token capability.
// Il token resta segreto: via preferita POST body, query solo per compatibilita` legacy.
function noStoreResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    const queryToken = new URL(request.url).searchParams.get('token')
    let bodyToken: string | undefined
    if (!queryToken) {
      requireApiJson(request)
      bodyToken = (await readApiJson<{ token?: string }>(request, cancelSchema)).token
    }
    const token = queryToken ?? bodyToken
    if (!token) return noStoreResponse(apiV1Validation('Token cancellazione obbligatorio', requestId))
    try {
      getCancelDeletionTokenOwner(token)
    } catch {
      return noStoreResponse(apiErr('UNAUTHORIZED', 'Token cancellazione non valido', 401, requestId))
    }
    const restored = await cancelDeletion(token)
    if (!restored) return noStoreResponse(apiErr('ACCOUNT_DELETION_FAILED', 'Stato account modificato: ripristino non eseguito', 409, requestId))
    return noStoreResponse(apiOk({ restored: true }, requestId))
  } catch (error) {
    return noStoreResponse(apiV1Error(error, requestId))
  }
}
