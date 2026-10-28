import { apiOk } from '@/lib/http/apiResponse'
import { apiV1Error, apiV1Validation, getApiRequestId, requireApiUser } from '@/lib/http/apiV1'
import { getUserJobStatus } from '@/lib/services/user-jobs'
import { z } from 'zod'

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const { jobId } = await context.params
    const parsedJobId = z.string().uuid().safeParse(jobId)
    if (!parsedJobId.success) return apiV1Validation('jobId non valido', requestId)
    const jobStatus = await getUserJobStatus({ userId: current.user.id, jobId: parsedJobId.data, supabase: current.supabase })
    const { errorMessage, ...publicJobStatus } = jobStatus
    const waitingReason = jobStatus.status === 'pending' && errorMessage === 'waiting_for_credential'
      ? 'youtube_key_missing'
      : null
    return apiOk({ ...publicJobStatus, waitingReason }, requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
