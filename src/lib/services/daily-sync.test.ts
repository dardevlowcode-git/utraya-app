import { beforeEach, describe, expect, it, vi } from 'vitest'

const { processPendingCredentialValidationJobsMock, performCredentialValidationAttemptMock } = vi.hoisted(() => ({
  processPendingCredentialValidationJobsMock: vi.fn(),
  performCredentialValidationAttemptMock: vi.fn(),
}))

vi.mock('@/lib/services/credential-validation-jobs', () => ({
  processPendingCredentialValidationJobs: processPendingCredentialValidationJobsMock,
}))
vi.mock('@/lib/services/integrations', () => ({
  performCredentialValidationAttempt: performCredentialValidationAttemptMock,
}))
vi.mock('@/lib/services/channels', () => ({
  processPendingScanJobs: vi.fn(),
  requestScanNowForUser: vi.fn(),
}))
vi.mock('@/lib/services/transcription-requests', () => ({ recoverTranscriptionJobs: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import {
  CREDENTIAL_VALIDATION_RECOVERY_MAX_BATCHES,
  computeNextSyncIso,
  isChannelDue,
  recoverCredentialValidationJobs,
} from '@/lib/services/daily-sync'

describe('daily-sync service helpers', () => {
  it('considers channel due when next_sync_at is in the past', () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const due = isChannelDue({
      now,
      syncFrequencyHours: 24,
      syncState: {
        last_sync_at: '2026-04-29T08:00:00.000Z',
        next_sync_at: '2026-04-30T09:59:59.000Z',
      },
    })

    expect(due).toBe(true)
  })

  it('computes next sync by adding the requested frequency', () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    expect(computeNextSyncIso(now, 24)).toBe('2026-05-01T10:00:00.000Z')
    expect(computeNextSyncIso(now, 6)).toBe('2026-04-30T16:00:00.000Z')
  })
})

describe('recovery giornaliero delle validazioni chiave', () => {
  beforeEach(() => vi.clearAllMocks())

  it('riprende i job dovuti con il provider same-key finché i batch sono vuoti', async () => {
    processPendingCredentialValidationJobsMock
      .mockResolvedValueOnce({ claimed: 3, completed: 2, pending: 1, failed: 0 })
      .mockResolvedValueOnce({ claimed: 1, completed: 0, pending: 0, failed: 1 })
      .mockResolvedValueOnce({ claimed: 0, completed: 0, pending: 0, failed: 0 })

    const result = await recoverCredentialValidationJobs()

    expect(result).toEqual({ claimed: 4, completed: 2, pending: 1, failed: 1 })
    expect(processPendingCredentialValidationJobsMock).toHaveBeenCalledTimes(3)
    expect(processPendingCredentialValidationJobsMock).toHaveBeenCalledWith({ attemptProvider: performCredentialValidationAttemptMock })
  })

  it('resta bounded anche se ci sono sempre job da claimare', async () => {
    processPendingCredentialValidationJobsMock.mockResolvedValue({ claimed: 3, completed: 3, pending: 0, failed: 0 })

    const result = await recoverCredentialValidationJobs()

    expect(processPendingCredentialValidationJobsMock).toHaveBeenCalledTimes(CREDENTIAL_VALIDATION_RECOVERY_MAX_BATCHES)
    expect(result.claimed).toBe(3 * CREDENTIAL_VALIDATION_RECOVERY_MAX_BATCHES)
  })
})
