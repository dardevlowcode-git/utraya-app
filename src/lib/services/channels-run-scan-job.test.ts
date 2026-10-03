/* Commento didattico:
 * Scopo del file: verifica il lifecycle pubblico di un job di scansione.
 * Moduli richiamati: `runScanJob`, client Supabase admin e servizio import video.
 * Flusso: sospende l'import e verifica che il claim con attempt running preceda il lavoro.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/utils/errors'

const { createAdminClientMock, claimScanJobMock, finishScanJobMock, importChannelVideosMock, events } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  claimScanJobMock: vi.fn(),
  finishScanJobMock: vi.fn(),
  importChannelVideosMock: vi.fn(),
  events: [] as string[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/lib/services/videos', () => ({
  importChannelVideos: importChannelVideosMock,
}))

import { runScanJob } from '@/lib/services/channels'

function builder(value: unknown) {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (result: unknown) => void, reject?: (error: unknown) => void) =>
          Promise.resolve(value).then(resolve, reject)
      }
      if (property === 'single' || property === 'maybeSingle') {
        return () => Promise.resolve(value)
      }
      return (..._args: unknown[]) => builder(value)
    },
  })
}

describe('runScanJob attempt lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    claimScanJobMock.mockImplementation(async (args: { p_lease_id: string }) => {
      events.push('claim-with-running-attempt')
      return {
        data: [{ job_id: 'job-1', lease_id: args.p_lease_id, attempt_id: 'attempt-1', attempt_number: 1 }],
        error: null,
      }
    })
    finishScanJobMock.mockImplementation(async () => {
      events.push('finish-attempt')
      return { data: true, error: null }
    })
    createAdminClientMock.mockReturnValue({
      rpc: vi.fn((name: string, args: unknown) => {
        if (name === 'claim_scan_job_with_attempt') return claimScanJobMock(args)
        if (name === 'finish_scan_job_attempt') return finishScanJobMock(args)
        throw new Error(`Unexpected RPC: ${name}`)
      }),
      from: vi.fn((table: string) => builder({ data: null, error: null })),
    })
  })

  it('creates the running attempt before starting the channel import', async () => {
    let markImportStarted!: () => void
    let releaseImport!: () => void
    const importStarted = new Promise<void>((resolve) => { markImportStarted = resolve })
    const importGate = new Promise<void>((resolve) => { releaseImport = resolve })

    importChannelVideosMock.mockImplementation(async () => {
      events.push('import-started')
      markImportStarted()
      await importGate
      return { channelId: 'channel-1', importedCount: 0, scannedCount: 0 }
    })

    const execution = runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' })
    await importStarted

    try {
      expect(events).toEqual(['claim-with-running-attempt', 'import-started'])
    } finally {
      releaseImport()
    }

    await expect(execution).resolves.toEqual({ claimed: true })
    expect(events).toEqual(['claim-with-running-attempt', 'import-started', 'finish-attempt'])
    expect(finishScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_job_id: 'job-1',
      p_lease_id: claimScanJobMock.mock.calls[0][0].p_lease_id,
      p_attempt_id: 'attempt-1',
      p_status: 'completed',
    }))
  })

  it('records a missing provider key on the same attempt and terminalizes the job', async () => {
    importChannelVideosMock.mockRejectedValueOnce(
      new AppError('Configura prima la chiave YouTube API', 'validation', 400)
    )

    await expect(runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' }))
      .rejects.toThrow('Configura prima la chiave YouTube API')

    expect(finishScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_job_id: 'job-1',
      p_attempt_id: 'attempt-1',
      p_status: 'failed',
      p_error_message: 'Configura prima la chiave YouTube API',
      p_error_details: expect.objectContaining({ type: 'validation', statusCode: 400 }),
    }))
  })
})
