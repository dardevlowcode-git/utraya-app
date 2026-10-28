import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runScanJob: vi.fn(),
  enqueue: vi.fn(),
  runAuto: vi.fn(),
}))

vi.mock('@/lib/services/channels', () => ({
  addChannelForUser: vi.fn(),
  enqueueScanJobForUser: mocks.enqueue,
  runScanJob: mocks.runScanJob,
}))
vi.mock('@/lib/services/transcription-auto', () => ({ runAutoTranscriptionsForChannel: mocks.runAuto }))

import { queueChannelScan } from '@/lib/services/channel-scan-actions'

describe('background dello scan canale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enqueue.mockResolvedValue({ jobId: 'scan-1', deduplicated: false })
    mocks.runScanJob.mockResolvedValue({ claimed: true })
    mocks.runAuto.mockResolvedValue(null)
  })

  async function background() {
    const queued = await queueChannelScan({
      userId: 'user-1', channelId: 'channel-1', supabase: {} as never, source: 'manual_scan',
    })
    return queued.background!
  }

  it('dopo lo scan lavora la trascrizione automatica del canale nello stesso task', async () => {
    const order: string[] = []
    mocks.runScanJob.mockImplementation(async () => { order.push('scan'); return { claimed: true } })
    mocks.runAuto.mockImplementation(async () => { order.push('transcription'); return null })

    await (await background())()

    expect(order).toEqual(['scan', 'transcription'])
    expect(mocks.runAuto).toHaveBeenCalledWith('channel-1')
  })

  it('anche se lo scan fallisce non lancia e prova comunque i job già in coda', async () => {
    mocks.runScanJob.mockRejectedValue(new Error('scan failed'))

    await expect((await background())()).resolves.toBeUndefined()
    expect(mocks.runAuto).toHaveBeenCalledWith('channel-1')
  })

  it('uno scan deduplicato non crea task in background', async () => {
    mocks.enqueue.mockResolvedValue({ jobId: 'scan-1', deduplicated: true })

    const queued = await queueChannelScan({ userId: 'user-1', channelId: 'channel-1', supabase: {} as never, source: 'manual_scan' })

    expect(queued.background).toBeNull()
  })
})
