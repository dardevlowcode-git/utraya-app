/* Commento didattico:
 * Scopo del file: endpoint per registrare accettazioni TOS/clausole vessatorie con envelope standard e requestId.
 * Moduli richiamati: auth abstraction, service legal acceptance, helper HTTP/security.
 * Flusso: valida input, legge utente corrente, salva accettazioni mancanti e restituisce esito API uniforme.
 */

import { getCurrentUser } from '@/lib/auth/getCurrentUser'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { mapAppErrorTypeToCode } from '@/lib/http/errorCodes'
import { ensureJsonRequest, ensureSameOrigin, getClientIp, getRequestId } from '@/lib/security/http'
import { recordLegalAcceptance } from '@/lib/services/legal-acceptance'
import { AppError } from '@/lib/utils/errors'
import type { LegalAcceptanceKind } from '@/lib/view-models/legalAcceptance'

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
    const current = await getCurrentUser()
    if (!current) {
      return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)
    }
    const userEmail = current.user.email
    if (!userEmail) {
      return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)
    }

    const body = (await request.json().catch(() => null)) as { kinds?: unknown; locale?: unknown } | null
    const kinds = body?.kinds
    if (
      !Array.isArray(kinds) ||
      kinds.length === 0 ||
      !kinds.every((kind): kind is LegalAcceptanceKind => kind === 'tos' || kind === 'tos_vexatorious')
    ) {
      return apiErr('VALIDATION_FAILED', 'kinds obbligatorio', 400, requestId)
    }
    const locale = body?.locale === 'en' ? 'en' : 'it'

    await recordLegalAcceptance({
      userId: current.user.id,
      userEmail,
      kinds,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      locale,
    })

    return apiOk({ accepted: true }, requestId)
  } catch (error) {
    if (error instanceof AppError) {
      return apiErr(mapAppErrorTypeToCode(error.type), error.message, error.statusCode ?? 500, requestId)
    }
    return apiErr(
      'LEGAL_ACCEPTANCE_FAILED',
      error instanceof Error ? error.message : 'Errore registrazione accettazione',
      500,
      requestId
    )
  }
}
