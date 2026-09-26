/* Commento didattico:
 * Scopo del file: registra accettazioni TOS versionate per il client mobile autenticato.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/legal-acceptance`, `@/lib/security/http`.
 * Flusso: valida solo tipi allowlistati, usa user/email dal JWT e salva audit server-side.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1Validation, getApiRequestId, readApiJson, requireApiJson, requireApiRateLimit, requireApiUser } from '@/lib/http/apiV1'
import { getClientIp } from '@/lib/security/http'
import { recordLegalAcceptance } from '@/lib/services/legal-acceptance'
import type { LegalAcceptanceKind } from '@/lib/view-models/legalAcceptance'
import { z } from 'zod'

const legalSchema = z.object({
  kinds: z.array(z.enum(['tos', 'tos_vexatorious'])).min(1).max(2),
  locale: z.enum(['it', 'en']).optional(),
}).strict()

export async function POST(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    requireApiJson(request)
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:legal:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<{ kinds: LegalAcceptanceKind[]; locale?: 'it' | 'en' }>(request, legalSchema)
    const kinds = Array.isArray(body.kinds)
      ? body.kinds.filter((kind): kind is LegalAcceptanceKind => kind === 'tos' || kind === 'tos_vexatorious')
      : []
    if (kinds.length === 0) return apiV1Validation('kinds obbligatorio', requestId)
    await recordLegalAcceptance({
      userId: current.user.id,
      userEmail: current.user.email ?? '',
      kinds: Array.from(new Set(kinds)),
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      locale: body.locale === 'en' ? 'en' : 'it',
    })
    return apiOk({ accepted: true }, requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
