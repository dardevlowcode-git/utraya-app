export type DeletionRequestView = {
  status: 'none' | 'pending' | 'cancelled' | 'executing' | 'completed' | 'failed'
  scheduledFor: string | null
  requestedAt: string | null
  canCancel: boolean
  daysRemaining: number | null
  cancelToken: string | null
}
