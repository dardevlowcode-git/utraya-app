/* Commento didattico:
 * Scopo: elimina ogni giorno gli eventi d'uso API più vecchi della retention di 30 giorni.
 * Moduli richiamati: `node:crypto`, `@/lib/services/api-usage`, `@/lib/http/apiResponse`.
 * Flusso: valida il Bearer CRON_SECRET in constant-time e rimuove solo righe scadute.
 */

import { timingSafeEqual } from 'node:crypto'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { cleanupExpiredApiUsageEvents } from '@/lib/services/api-usage'

export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const secret = process.env.CRON_SECRET
  if (!secret) return apiErr('CRON_MISCONFIGURED', 'CRON_SECRET mancante', 500, requestId)

  const received = Buffer.from(request.headers.get('authorization') ?? '', 'utf8')
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return apiErr('CRON_UNAUTHORIZED', 'Unauthorized', 401, requestId)
  }

  try {
    const deletedCount = await cleanupExpiredApiUsageEvents()
    return apiOk({ deletedCount }, requestId)
  } catch {
    return apiErr('API_USAGE_CLEANUP_FAILED', 'Cleanup utilizzo API fallito', 500, requestId)
  }
}
