/* Commento didattico:
 * Scopo del file: endpoint pubblico (tokenizzato) per annullare una richiesta cancellazione account entro il grace period.
 * Moduli richiamati: service account deletion e helper envelope API.
 * Flusso: valida token firmato, ripristina lo stato precedente se ancora coerente e risponde con esito standard.
 */

import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { cancelDeletion } from '@/lib/services/account-deletion'

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    const url = new URL(request.url)
    const tokenFromQuery = url.searchParams.get('token')
    const body = (await request.json().catch(() => null)) as { token?: string } | null
    const token = tokenFromQuery ?? body?.token

    if (!token) {
      return noStore(apiErr('VALIDATION_FAILED', 'Token mancante', 400, requestId))
    }

    const restored = await cancelDeletion(token)
    if (!restored) return noStore(apiErr('ACCOUNT_DELETION_FAILED', 'Stato account modificato: ripristino non eseguito', 409, requestId))
    return noStore(apiOk({ restored: true }, requestId))
  } catch (error) {
    return noStore(apiErr('ACCOUNT_DELETION_FAILED', 'Impossibile annullare cancellazione', 400, requestId))
  }
}

// Impedisce caching delle risposte su un flusso che trasporta token capability.
// Il token resta segreto: via preferita POST body, query solo per compatibilita` legacy.
function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}
