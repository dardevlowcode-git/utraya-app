import { getCurrentUser } from '@/lib/auth/getCurrentUser'
import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getClientIp, getRequestId } from '@/lib/security/http'
import { requestDeletion } from '@/lib/services/account-deletion'

export async function DELETE(request: Request) {
  const requestId = getRequestId(request)

  try {
    const current = await getCurrentUser()
    if (!current) return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)
    const userEmail = current.user.email
    if (!userEmail) return apiErr('UNAUTHORIZED', 'Sessione non valida', 401, requestId)

    const body = (await request.json().catch(() => null)) as { reason?: string | null } | null
    const reason = typeof body?.reason === 'string' ? body.reason : null

    const result = await requestDeletion({
      userId: current.user.id,
      userEmail,
      reason,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId,
    })

    await current.supabase.auth.signOut()

    return apiOk({ scheduledFor: result.scheduledFor, cancelUrl: result.cancelUrl }, requestId, 202)
  } catch (error) {
    return apiErr('ACCOUNT_DELETION_FAILED', error instanceof Error ? error.message : 'Errore cancellazione account', 500, requestId)
  }
}
