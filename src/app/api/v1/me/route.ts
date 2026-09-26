/* Commento didattico:
 * Scopo del file: espone il profilo minimo e gli stati necessari al bootstrap del client mobile.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/legal-acceptance`, `@/lib/services/account-deletion`.
 * Flusso: una sola richiesta Bearer restituisce identità non privilegiata e stato legale/account aggregato.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, getApiRequestId, requireApiUser } from '@/lib/http/apiV1'
import { getDeletionRequestView } from '@/lib/services/account-deletion'
import { getLegalAcceptanceStatus } from '@/lib/services/legal-acceptance'
import { apiV1Validation } from '@/lib/http/apiV1'
import { z } from 'zod'

export async function GET(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const localeParam = new URL(request.url).searchParams.get('locale')
    const locale = localeParam === null ? 'it' : z.enum(['it', 'en']).safeParse(localeParam)
    if (typeof locale !== 'string' && !locale.success) return apiV1Validation('locale non valida', requestId)
    const localeValue = typeof locale === 'string' ? locale : locale.data
    const [legal, deletion] = await Promise.all([
      getLegalAcceptanceStatus(current.user.id, localeValue),
      getDeletionRequestView(current.user.id),
    ])
    return apiOk({
      user: { id: current.user.id, email: current.user.email, createdAt: current.user.created_at },
      legal,
      deletion,
    }, requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
