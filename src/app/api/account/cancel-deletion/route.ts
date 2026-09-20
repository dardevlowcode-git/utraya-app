/* Commento didattico:
 * Scopo del file: endpoint pubblico (tokenizzato) per annullare una richiesta cancellazione account entro il grace period.
 * Moduli richiamati: service account deletion e helper envelope API.
 * Flusso: valida token firmato, ripristina stato utente attivo e risponde con esito standard.
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
      return apiErr('VALIDATION_FAILED', 'Token mancante', 400, requestId)
    }

    await cancelDeletion(token)
    return apiOk({ restored: true }, requestId)
  } catch (error) {
    return apiErr('ACCOUNT_DELETION_FAILED', error instanceof Error ? error.message : 'Impossibile annullare cancellazione', 400, requestId)
  }
}