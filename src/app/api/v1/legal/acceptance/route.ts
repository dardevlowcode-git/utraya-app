/* Commento didattico:
 * Scopo del file: restituisce al client mobile lo stato delle accettazioni legali richieste.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/legal-acceptance`.
 * Flusso: l'utente è identificato dal Bearer e il service usa versioni/hash canonici server-side.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, getApiRequestId, requireApiUser } from '@/lib/http/apiV1'
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
    return apiOk(await getLegalAcceptanceStatus(current.user.id, typeof locale === 'string' ? locale : locale.data), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
