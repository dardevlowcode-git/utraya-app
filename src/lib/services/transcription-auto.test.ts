import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runJobNow: vi.fn(),
  hasEligible: vi.fn(),
  continuation: vi.fn(),
  pendingJobs: [] as Array<{ id: string }>,
  jobPayload: null as unknown,
}))

vi.mock('@/lib/services/transcription-requests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/transcription-requests')>()),
  runTranscriptionJobNow: mocks.runJobNow,
  hasEligibleChannelCredential: mocks.hasEligible,
}))
vi.mock('@/lib/services/transcription-store', () => ({ requestTranscriptionContinuation: mocks.continuation }))
vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: mocks.pendingJobs, error: null }),
        maybeSingle: async () => ({ data: { payload: mocks.jobPayload }, error: null }),
      }
      return query
    },
  }),
}))

import {
  POST_SCAN_TRANSCRIPTION_BUDGET,
  runAutoTranscriptionsForChannel,
  runTranscriptionJobAndChain,
} from '@/lib/services/transcription-auto'

const CHANNEL = '11111111-1111-4111-8111-111111111111'
const autoPayload = { videoId: 'v', transcriptionId: 't', requestedByUserId: null, credentialOwnerUserId: null, channelId: CHANNEL }

describe('trascrizione automatica dopo lo scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pendingJobs = [{ id: 'job-a' }, { id: 'job-b' }]
    mocks.jobPayload = autoPayload
    mocks.hasEligible.mockResolvedValue(true)
    mocks.runJobNow.mockResolvedValue({ outcome: 'complete', partsSaved: 3 })
    mocks.continuation.mockResolvedValue(undefined)
  })

  it('lavora un solo job del canale con il budget ridotto e chiede il successivo a job concluso', async () => {
    const result = await runAutoTranscriptionsForChannel(CHANNEL)

    expect(result).toEqual({ outcome: 'complete', partsSaved: 3 })
    expect(mocks.runJobNow).toHaveBeenCalledTimes(1)
    expect(mocks.runJobNow).toHaveBeenCalledWith('job-a', POST_SCAN_TRANSCRIPTION_BUDGET)
    expect(mocks.continuation).toHaveBeenCalledTimes(1)
    expect(mocks.continuation).toHaveBeenCalledWith('job-b')
  })

  it('senza chiave eleggibile nel canale non reclama nulla', async () => {
    mocks.hasEligible.mockResolvedValue(false)

    expect(await runAutoTranscriptionsForChannel(CHANNEL)).toBeNull()
    expect(mocks.runJobNow).not.toHaveBeenCalled()
    expect(mocks.continuation).not.toHaveBeenCalled()
  })

  it('senza job pending non fa nulla', async () => {
    mocks.pendingJobs = []

    expect(await runAutoTranscriptionsForChannel(CHANNEL)).toBeNull()
    expect(mocks.runJobNow).not.toHaveBeenCalled()
  })

  it('non lancia mai verso lo scan, anche se il worker fallisce', async () => {
    mocks.runJobNow.mockRejectedValue(new Error('boom'))

    await expect(runAutoTranscriptionsForChannel(CHANNEL)).resolves.toBeNull()
  })

  it.each(['yielded', 'waiting', 'lease_lost', 'not_claimed'] as const)(
    'con esito %s non avvia il video successivo (il job riprende da solo o dal daily-sync)',
    async (outcome) => {
      mocks.runJobNow.mockResolvedValue({ outcome, partsSaved: 0 })

      await runTranscriptionJobAndChain('job-a')

      expect(mocks.continuation).not.toHaveBeenCalled()
    }
  )

  it('un job manuale concluso non avvia catene', async () => {
    mocks.jobPayload = { ...autoPayload, credentialOwnerUserId: 'user-1', requestedByUserId: 'user-1', channelId: null }

    await runTranscriptionJobAndChain('job-a')

    expect(mocks.continuation).not.toHaveBeenCalled()
  })

  it('la catena salta il job appena concluso e si ferma se non ce ne sono altri', async () => {
    mocks.pendingJobs = [{ id: 'job-a' }]

    await runTranscriptionJobAndChain('job-a')

    expect(mocks.continuation).not.toHaveBeenCalled()
  })
})
