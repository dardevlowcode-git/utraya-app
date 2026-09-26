/* Commento didattico:
 * Scopo del file: broker interno che evita Bearer secret statici in GitHub Actions per il verificatore API.
 * Moduli richiamati: `@/lib/verifier/api-verifier`, `@/lib/security/githubOidc`.
 * Flusso: valida rate limit, target, OIDC monouso e flag mutazioni, poi delega la suite al modulo verifier.
 */

import { z } from 'zod'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getClientIp, getRequestId } from '@/lib/security/http'
import { consumeGitHubOidcJti } from '@/lib/security/githubOidcReplay'
import { verifyGitHubActionsOidc } from '@/lib/security/githubOidc'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { runApiVerification, verifierTargetOrigins, type VerifierTarget } from '@/lib/verifier/api-verifier'

const requestSchema = z.object({
  target: z.enum(['preview', 'production']),
  mutations: z.boolean().default(false),
  confirmProductionFixture: z.boolean().default(false),
}).strict()

function brokerResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const requestId = getRequestId(request)
  try {
    const brokerKey = `broker:${getClientIp(request) ?? 'unknown'}`
    const brokerLimit = checkRateLimit(brokerKey, 12, 60_000)
    if (!brokerLimit.allowed) {
      const limited = apiErr('RATE_LIMITED', 'Troppe richieste al verificatore', 429, requestId)
      limited.headers.set('Retry-After', String(Math.max(Math.ceil(brokerLimit.resetAfterMs / 1000), 1)))
      return brokerResponse(limited)
    }
    const parsedBody = requestSchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) return brokerResponse(apiErr('VALIDATION_FAILED', 'Payload verifier non valido', 400, requestId))
    const body = parsedBody.data
    const requestOrigin = new URL(request.url).origin.toLowerCase()
    const deploymentTarget = (Object.entries(verifierTargetOrigins) as Array<[VerifierTarget, string]>)
      .find(([, origin]) => origin === requestOrigin)?.[0] ?? null
    if (deploymentTarget !== body.target) return brokerResponse(apiErr('FORBIDDEN', 'Target non autorizzato', 403, requestId))
    try {
      const oidcClaims = await verifyGitHubActionsOidc(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '', body.target)
      await consumeGitHubOidcJti(oidcClaims.jti, oidcClaims.exp)
    } catch {
      return brokerResponse(apiErr('UNAUTHORIZED', 'OIDC non autorizzato', 401, requestId))
    }
    if (body.target === 'production' && body.mutations && !body.confirmProductionFixture) return brokerResponse(apiErr('VALIDATION_FAILED', 'Conferma fixture production obbligatoria', 400, requestId))
    if (body.mutations && process.env.API_E2E_ALLOW_MUTATIONS !== 'true') return brokerResponse(apiErr('FORBIDDEN', 'Mutazioni verifier disabilitate', 403, requestId))

    const report = await runApiVerification({ target: body.target, mutations: body.mutations })
    const { failedCount, ...payload } = report
    return brokerResponse(apiOk(payload, requestId, failedCount ? 207 : 200))
  } catch {
    return brokerResponse(apiErr('INTERNAL_ERROR', 'Errore interno', 500, requestId))
  }
}
