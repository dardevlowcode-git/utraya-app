/* Commento didattico:
 * Scopo del file: verifica il lifecycle pubblico di un job di scansione.
 * Moduli richiamati: `runScanJob`, client Supabase admin e servizio import video.
 * Flusso: sospende l'import e verifica che il claim con attempt running preceda il lavoro.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/utils/errors'

const { createAdminClientMock, claimScanJobMock, finishScanJobMock, deferScanJobMock, importChannelVideosMock, processFirecrawlMock, events } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  claimScanJobMock: vi.fn(),
  finishScanJobMock: vi.fn(),
  deferScanJobMock: vi.fn(),
  importChannelVideosMock: vi.fn(),
  processFirecrawlMock: vi.fn(),
  events: [] as string[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/lib/services/videos', () => ({
  importChannelVideos: importChannelVideosMock,
}))
vi.mock('@/lib/services/firecrawl-transcript-recovery', () => ({
  processNextFirecrawlTranscriptRecovery: processFirecrawlMock,
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
    vi.resetAllMocks()
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
    deferScanJobMock.mockImplementation(async () => ({ data: true, error: null }))
    processFirecrawlMock.mockResolvedValue({ status: 'disabled' })
    createAdminClientMock.mockReturnValue({
      rpc: vi.fn((name: string, args: unknown) => {
        if (name === 'claim_scan_job_with_attempt') return claimScanJobMock(args)
        if (name === 'finish_scan_job_attempt') return finishScanJobMock(args)
        if (name === 'defer_scan_job_attempt') return deferScanJobMock(args)
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
    processFirecrawlMock.mockImplementation(async () => {
      events.push('firecrawl-recovery')
      return { status: 'disabled' }
    })

    const execution = runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' })
    await importStarted

    try {
      expect(events).toEqual(['claim-with-running-attempt', 'import-started'])
    } finally {
      releaseImport()
    }

    await expect(execution).resolves.toEqual({ claimed: true })
    expect(events).toEqual(['claim-with-running-attempt', 'import-started', 'firecrawl-recovery', 'finish-attempt'])
    expect(finishScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_job_id: 'job-1',
      p_lease_id: claimScanJobMock.mock.calls[0][0].p_lease_id,
      p_attempt_id: 'attempt-1',
      p_status: 'completed',
    }))
    expect(processFirecrawlMock).toHaveBeenCalledWith({ lease: expect.objectContaining({
      jobId: 'job-1',
      channelId: 'channel-1',
    }) })
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

  it('rilascia a pending un job che attende chiave o backoff senza terminalizzare il ciclo', async () => {
    importChannelVideosMock.mockRejectedValueOnce(new AppError(
      'Retry YouTube pianificato',
      'temporary',
      409,
      { channelScanDisposition: 'deferred', retryAt: '2026-10-12T00:00:01.000Z' },
    ))

    await expect(runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' }))
      .resolves.toEqual({ claimed: true })

    expect(deferScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_job_id: 'job-1',
      p_lease_id: claimScanJobMock.mock.calls[0][0].p_lease_id,
      p_attempt_id: 'attempt-1',
      p_available_at: '2026-10-12T00:00:01.000Z',
      p_reason: 'provider_retry_backoff',
    }))
    expect(finishScanJobMock).not.toHaveBeenCalled()
  })

  it('mantiene in attesa il solo job senza chiavi mentre il worker prosegue gli altri', async () => {
    importChannelVideosMock.mockRejectedValueOnce(new AppError(
      'Scansione in attesa di una chiave YouTube eleggibile',
      'temporary',
      409,
      { channelScanDisposition: 'waiting' },
    ))

    await expect(runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' }))
      .resolves.toEqual({ claimed: true })

    expect(deferScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_job_id: 'job-1',
      p_available_at: null,
      p_reason: 'waiting_for_credential',
    }))
    expect(finishScanJobMock).not.toHaveBeenCalled()
  })

  it('terminalizza esplicitamente il job quando tutte le chiavi eleggibili sono esaurite', async () => {
    importChannelVideosMock.mockRejectedValueOnce(new AppError(
      'Tutte le chiavi YouTube eleggibili sono esaurite per questo job',
      'structural',
      422,
      { code: 'YOUTUBE_KEYS_EXHAUSTED' },
    ))

    await expect(runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' }))
      .rejects.toMatchObject({ context: expect.objectContaining({ code: 'YOUTUBE_KEYS_EXHAUSTED' }) })

    expect(finishScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_job_id: 'job-1',
      p_status: 'failed',
      p_error_message: 'Tutte le chiavi YouTube eleggibili sono esaurite per questo job',
    }))
    expect(deferScanJobMock).not.toHaveBeenCalled()
  })

  it('non avvia un secondo worker se un altro claim ha già acquisito il job', async () => {
    claimScanJobMock.mockResolvedValueOnce({ data: [], error: null })

    await expect(runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' }))
      .resolves.toEqual({ claimed: false })

    expect(importChannelVideosMock).not.toHaveBeenCalled()
    expect(finishScanJobMock).not.toHaveBeenCalled()
  })

  it('riprende il job con una nuova lease dopo aver persistito una risposta provider', async () => {
    let claimNumber = 0
    claimScanJobMock.mockImplementation(async (args: { p_lease_id: string }) => {
      claimNumber += 1
      events.push(`claim-${claimNumber}`)
      return {
        data: [{
          job_id: 'job-1',
          lease_id: args.p_lease_id,
          attempt_id: `attempt-${claimNumber}`,
          attempt_number: claimNumber,
        }],
        error: null,
      }
    })
    deferScanJobMock.mockImplementation(async () => {
      events.push('defer-provider-checkpoint')
      return { data: true, error: null }
    })
    importChannelVideosMock
      .mockRejectedValueOnce(new AppError('Provider response checkpointed', 'temporary', 409, {
        channelScanDisposition: 'deferred',
        dispositionReason: 'provider_request_checkpoint',
      }))
      .mockResolvedValueOnce({ channelId: 'channel-1', importedCount: 0, scannedCount: 0 })

    await expect(runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' }))
      .resolves.toEqual({ claimed: true })

    expect(events).toEqual([
      'claim-1',
      'defer-provider-checkpoint',
      'claim-2',
      'finish-attempt',
    ])
    expect(claimScanJobMock.mock.calls[0][0].p_lease_id)
      .not.toBe(claimScanJobMock.mock.calls[1][0].p_lease_id)
    expect(finishScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_attempt_id: 'attempt-2',
      p_status: 'completed',
    }))
  })

  it('defers Firecrawl con la stessa lease fenced dopo import e riprende nella lease seguente', async () => {
    let claimNumber = 0
    claimScanJobMock.mockImplementation(async (args: { p_lease_id: string }) => {
      claimNumber += 1
      return { data: [{ job_id: 'job-1', lease_id: args.p_lease_id, attempt_id: `attempt-${claimNumber}`, attempt_number: claimNumber }], error: null }
    })
    importChannelVideosMock.mockImplementation(async () => { events.push('import-committed') })
    processFirecrawlMock
      .mockRejectedValueOnce(new AppError('Firecrawl checkpoint', 'temporary', 409, {
        channelScanDisposition: 'deferred',
        dispositionReason: 'provider_request_checkpoint',
      }))
      .mockImplementationOnce(async () => { events.push('firecrawl-recovered'); return { status: 'idle' } })

    await expect(runScanJob({ userId: 'user-1', channelId: 'channel-1', jobId: 'job-1' }))
      .resolves.toEqual({ claimed: true })

    expect(deferScanJobMock).toHaveBeenCalledWith(expect.objectContaining({
      p_attempt_id: 'attempt-1',
      p_reason: 'provider_request_checkpoint',
    }))
    expect(events).toEqual(['import-committed', 'import-committed', 'firecrawl-recovered', 'finish-attempt'])
    expect(processFirecrawlMock).toHaveBeenCalledTimes(2)
    expect(finishScanJobMock).toHaveBeenCalledWith(expect.objectContaining({ p_attempt_id: 'attempt-2', p_status: 'completed' }))
  })
})
