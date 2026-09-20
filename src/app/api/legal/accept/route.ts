/* Commento didattico:
 * Scopo del file: endpoint per registrare accettazioni TOS/clausole vessatorie con envelope standard e requestId.
 * Moduli richiamati: auth abstraction, service legal acceptance, helper HTTP/security.
 * Flusso: valida input, legge utente corrente, salva accettazioni mancanti e restituisce esito API uniforme.
 */

import { getCurrentUser } from '@/lib/auth/getCurrentUser'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getClientIp, getRequestId } from '@/lib/security/http'
import { recordLegalAcceptance } from '@/lib/services/legal-acceptance'
import type { LegalAcceptanceKind } from '@/lib/view-models/legalAcceptance'

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    const current = await getCurrentUser()
    if (!current) {
      return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)
    }
    const userEmail = current.user.email
    if (!userEmail) {
      return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)
    }

    const body = (await request.json().catch(() => null)) as { kinds?: LegalAcceptanceKind[]; locale?: 'it' | 'en' } | null
    const kinds = Array.isArray(body?.kinds) ? body.kinds : []
    const locale = body?.locale === 'en' ? 'en' : 'it'

    if (kinds.length === 0) {
      return apiErr('VALIDATION_FAILED', 'kinds obbligatorio', 400, requestId)
    }

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
    return apiErr(
      'LEGAL_ACCEPTANCE_FAILED',
      error instanceof Error ? error.message : 'Errore registrazione accettazione',
      500,
      requestId
    )
  }
}
