import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_TRANSCRIPTIONS_PAGE_SIZE,
  getAdminReviewStats,
  listAdminTranscriptions,
  relaunchMissingParts,
} from '@/lib/services/admin-transcriptions'

type Admin = Parameters<typeof listAdminTranscriptions>[0]

function listClient(result: { data: unknown[]; count: number; error?: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'order', 'range']) {
    q[name] = (...args: unknown[]) => { calls.push([name, ...args]); return q }
  }
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, ...result }).then(resolve)
  return { admin: { from: () => q } as unknown as Admin, calls }
}

const dbRow = {
  id: 't1', status: 'needs_review', model: 'm', thinking_level: 'minimal', language_code: 'it',
  doubtful_phrase_count: 2, missing_part_count: 1, completed_at: '2026-10-18T10:00:00Z', updated_at: '2026-10-18T10:00:00Z',
  videos: { id: 'v1', title: 'T', youtube_video_id: 'yt', channels: { title: 'C' } },
  transcription_phrases: [{ count: 10 }],
  transcription_parts: [{ position: 2, start_seconds: 240, end_seconds: 360, last_error: 'timeout' }],
}

describe('elenco admin delle trascrizioni', () => {
  it('filtra per stato, include solo le parti mancanti e pagina', async () => {
    const { admin, calls } = listClient({ data: [dbRow], count: 60 })

    const list = await listAdminTranscriptions(admin, { filter: 'needs_review', page: 2 })

    expect(calls).toContainEqual(['eq', 'status', 'needs_review'])
    expect(calls).toContainEqual(['eq', 'transcription_parts.status', 'missing'])
    expect(calls).toContainEqual(['range', ADMIN_TRANSCRIPTIONS_PAGE_SIZE, ADMIN_TRANSCRIPTIONS_PAGE_SIZE * 2 - 1])
    expect(list).toMatchObject({ page: 2, pageCount: 3, total: 60 })
    expect(list.items[0]).toMatchObject({ id: 't1', phraseCount: 10, missingParts: [{ position: 2, interval: '4:00–6:00' }] })
  })

  it('con filtro "all" non filtra per stato', async () => {
    const { admin, calls } = listClient({ data: [], count: 0 })

    const list = await listAdminTranscriptions(admin, { filter: 'all', page: 1 })

    expect(calls.some((call) => call[0] === 'eq' && call[1] === 'status')).toBe(false)
    expect(list).toMatchObject({ items: [], pageCount: 1, total: 0 })
  })

  it('un errore del database non espone dettagli', async () => {
    const { admin } = listClient({ data: [], count: 0, error: { message: 'relation secret' } })

    await expect(listAdminTranscriptions(admin, { filter: 'all', page: 1 })).rejects.toThrow('Impossibile leggere le trascrizioni')
  })
})

describe('statistiche e rilancio', () => {
  it('legge 7 e 30 giorni dalla RPC', async () => {
    const rpc = vi.fn(async (_name: string, args: { p_days: number }) => ({
      data: [{ status: 'needs_review', total: args.p_days, doubtful_phrases: 0 }, { status: 'complete', total: args.p_days * 3, doubtful_phrases: 0 }],
      error: null,
    }))

    const stats = await getAdminReviewStats({ rpc } as unknown as Admin)

    expect(rpc).toHaveBeenCalledWith('transcription_review_stats', { p_days: 7 })
    expect(rpc).toHaveBeenCalledWith('transcription_review_stats', { p_days: 30 })
    expect(stats.map((window) => window.needsReviewPercent)).toEqual([25, 25])
  })

  it('rilancia passando trascrizione, parte e username admin', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ status: 'relaunched', job_id: 'j1', parts_reset: 2, credential_mode: 'channel_rotation' }], error: null,
    }))

    const result = await relaunchMissingParts({ rpc } as unknown as Admin, { transcriptionId: 't1', partPosition: null, adminUsername: 'admin' })

    expect(rpc).toHaveBeenCalledWith('relaunch_missing_transcription_parts', {
      p_transcription_id: 't1', p_part_position: null, p_admin_username: 'admin',
    })
    expect(result).toEqual({ status: 'relaunched', jobId: 'j1', partsReset: 2, credentialMode: 'channel_rotation' })
  })

  it.each(['not_found', 'no_missing', 'busy'] as const)('restituisce lo stato %s senza job', async (status) => {
    const rpc = vi.fn(async () => ({ data: [{ status, job_id: null, parts_reset: 0, credential_mode: null }], error: null }))

    expect(await relaunchMissingParts({ rpc } as unknown as Admin, { transcriptionId: 't1', partPosition: 3, adminUsername: 'a' })).toEqual({ status })
  })

  it('errore RPC: messaggio stabile senza dettagli', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'db detail' } }))

    await expect(relaunchMissingParts({ rpc } as unknown as Admin, { transcriptionId: 't1', partPosition: null, adminUsername: 'a' }))
      .rejects.toThrow('Impossibile rilanciare le parti mancanti')
  })
})
