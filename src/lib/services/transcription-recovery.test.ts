/* Commento didattico:
 * Scopo del file: verifica il recupero dei job di trascrizione nel daily-sync con i job automatici in attesa di chiave.
 * Moduli richiamati: `vitest`, servizio richieste, client admin e continuazione mockati.
 * Flusso: i job automatici di canali senza chiave eleggibile non sono reclamati né consumano il limite; i manuali sì.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jobs: [] as Array<{ id: string; payload: Record<string, unknown> }>,
  eligibleByChannel: {} as Record<string, boolean>,
  rpc: vi.fn(),
  continuation: vi.fn(),
}))

vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: vi.fn() }))
vi.mock('@/lib/services/transcription-store', () => ({
  createSupabaseTranscriptionStore: vi.fn(),
  requestTranscriptionContinuation: mocks.continuation,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        order: () => query,
        limit: async () => ({ data: mocks.jobs, error: null }),
      }
      return query
    },
    rpc: async (name: string, args: { p_channel_id: string }) => {
      mocks.rpc(name, args)
      return { data: mocks.eligibleByChannel[args.p_channel_id] ?? false, error: null }
    },
  }),
}))

import { recoverTranscriptionJobs } from '@/lib/services/transcription-requests'

const base = { videoId: 'v', transcriptionId: 't', requestedByUserId: null }
const auto = (id: string, channelId: string) => ({ id, payload: { ...base, credentialOwnerUserId: null, channelId } })
const manual = (id: string) => ({ id, payload: { ...base, requestedByUserId: 'u1', credentialOwnerUserId: 'u1' } })

describe('recupero giornaliero dei job di trascrizione', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.continuation.mockResolvedValue(undefined)
    mocks.eligibleByChannel = { 'chan-ok': true, 'chan-wait': false }
  })

  it('salta i job automatici senza chiave eleggibile e non li fa pesare sul limite', async () => {
    mocks.jobs = [auto('w1', 'chan-wait'), auto('w2', 'chan-wait'), manual('m1'), auto('a1', 'chan-ok'), auto('a2', 'chan-ok')]

    const result = await recoverTranscriptionJobs(2, { inline: false })

    expect(result).toEqual({ found: 2, resumedInline: 0, continued: 2 })
    expect(mocks.continuation.mock.calls.map((call) => call[0])).toEqual(['m1', 'a1'])
  })

  it('controlla le chiavi una volta per canale', async () => {
    mocks.jobs = [auto('w1', 'chan-wait'), auto('w2', 'chan-wait'), auto('a1', 'chan-ok'), auto('a2', 'chan-ok')]

    await recoverTranscriptionJobs(5, { inline: false })

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenCalledWith('has_eligible_transcription_credential', { p_channel_id: 'chan-wait' })
  })

  it('non reclama nulla se tutti i job attendono una chiave', async () => {
    mocks.jobs = [auto('w1', 'chan-wait')]

    expect(await recoverTranscriptionJobs(5, { inline: false })).toEqual({ found: 0, resumedInline: 0, continued: 0 })
    expect(mocks.continuation).not.toHaveBeenCalled()
  })
})
