import { timingSafeEqual } from 'node:crypto'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import { processPendingDeletionRequests } from '@/lib/services/account-deletion'

export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const secret = process.env.CRON_SECRET

  if (!secret) {
    return apiErr('CRON_MISCONFIGURED', 'CRON_SECRET mancante', 500, requestId)
  }

  const received = Buffer.from(request.headers.get('authorization') ?? '', 'utf8')
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  const isAuthorized = received.length === expected.length && timingSafeEqual(received, expected)

  if (!isAuthorized) {
    return apiErr('CRON_UNAUTHORIZED', 'Unauthorized', 401, requestId)
  }

  try {
    const result = await processPendingDeletionRequests()
    return apiOk(result, requestId)
  } catch (error) {
    return apiErr('ACCOUNT_DELETION_FAILED', error instanceof Error ? error.message : 'Errore cron cancellazione', 500, requestId)
  }
}