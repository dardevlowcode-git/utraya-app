/* Commento didattico:
 * Scopo del file: endpoint admin per force delete immediato utente con audit reason obbligatoria.
 * Moduli richiamati: auth admin, service account deletion, helper API/security.
 * Flusso: autorizza sessione admin, valida payload e invoca cancellazione immediata server-side.
 */

import { z } from 'zod'
import { getAdminSession } from '@/lib/auth/admin'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { mapAppErrorTypeToCode } from '@/lib/http/errorCodes'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'
import { forceDeleteUser } from '@/lib/services/account-deletion'
import { AppError } from '@/lib/utils/errors'

export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
  const requestId = getRequestId(request)

  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const adminSession = await getAdminSession()
    if (!adminSession) return apiErr('UNAUTHORIZED', 'Unauthorized', 401, requestId)

    const { userId } = await context.params
    if (!z.string().uuid().safeParse(userId).success) {
      return apiErr('VALIDATION_FAILED', 'Id utente non valido', 400, requestId)
    }
    const body = (await request.json().catch(() => null)) as { reason?: string } | null
    const reason = body?.reason?.trim().slice(0, 500)

    if (!reason) {
      return apiErr('VALIDATION_FAILED', 'Motivo obbligatorio', 400, requestId)
    }

    await forceDeleteUser(userId, adminSession.username, reason)
    return apiOk({ deleted: true }, requestId)
  } catch (error) {
    if (error instanceof AppError) {
      return apiErr(mapAppErrorTypeToCode(error.type), error.message, error.statusCode ?? 500, requestId)
    }
    return apiErr('ACCOUNT_DELETION_FAILED', error instanceof Error ? error.message : 'Errore force delete', 500, requestId)
  }
}
