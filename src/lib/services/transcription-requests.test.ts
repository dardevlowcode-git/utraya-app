/* Commento didattico:
 * Scopo del file: verifica richiesta, riuso e vista di stato della trascrizione con un database in memoria.
 * Moduli richiamati: `vitest`, servizio richieste, client Supabase finto (filtri, insert/upsert/update, vincoli unici).
 * Flusso: copre follower, chiave Gemini, riuso canonico senza chiave, creazione job/parti, job attivi, video non trascrivibile e paginazione frasi.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase/types'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: vi.fn() }))

import {
  getTranscriptionViewModel,
  loadFollowedVideo,
  requestTranscriptionForUser,
} from '@/lib/services/transcription-requests'
import { AppError } from '@/lib/utils/errors'

type Row = Record<string, unknown>
type Db = Record<string, Row[]>

/** Client minimale che imita la parte di PostgREST usata dai servizi (filtri, insert, upsert, update, range). */
function createFakeClient(db: Db, eligibleChannelCredential: boolean) {
  let counter = 0
  const read = (row: Row, column: string) => {
    if (column.includes('->>')) {
      const [base, key] = column.split('->>')
      return (row[base] as Row | undefined)?.[key]
    }
    return row[column]
  }
  class Query implements PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> {
    private filters: Array<(row: Row) => boolean> = []
    private mode: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    private values: Row[] = []
    private values1: Row = {}
    private rangeBounds: [number, number] | null = null
    private ignoreDuplicates = false
    private limitCount: number | null = null
    constructor(private table: string) {}
    select() { return this }
    order() { return this }
    limit(count: number) { this.limitCount = count; return this }
    range(from: number, to: number) { this.rangeBounds = [from, to]; return this }
    eq(column: string, value: unknown) { this.filters.push((row) => read(row, column) === value); return this }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(read(row, column))); return this }
    insert(values: Row | Row[]) { this.mode = 'insert'; this.values = Array.isArray(values) ? values : [values]; return this }
    upsert(values: Row[], options?: { ignoreDuplicates?: boolean }) {
      this.mode = 'upsert'; this.values = values; this.ignoreDuplicates = Boolean(options?.ignoreDuplicates); return this
    }
    update(values: Row) { this.mode = 'update'; this.values1 = values; return this }
    private violatesUnique(candidate: Row): boolean {
      const rows = db[this.table] ?? []
      if (this.table === 'transcriptions') return rows.some((row) => row.video_id === candidate.video_id)
      if (this.table === 'transcription_parts') {
        return rows.some((row) => row.transcription_id === candidate.transcription_id && row.position === candidate.position)
      }
      if (this.table === 'jobs') {
        const active = (row: Row) => row.job_type === 'transcribe_video' && ['pending', 'running'].includes(String(row.status))
        return active(candidate) && rows.some((row) => active(row) && read(row, 'payload->>videoId') === read(candidate, 'payload->>videoId'))
      }
      return false
    }
    private async exec() {
      const rows = (db[this.table] ??= [])
      if (this.mode === 'insert' || this.mode === 'upsert') {
        const inserted: Row[] = []
        for (const value of this.values) {
          if (this.violatesUnique(value)) {
            if (this.mode === 'upsert' && this.ignoreDuplicates) continue
            return { data: null, error: { code: '23505', message: 'duplicate' } }
          }
          counter += 1
          const row = { id: `${this.table}-${counter}`, ...value }
          rows.push(row)
          inserted.push(row)
        }
        return { data: inserted, error: null }
      }
      let selected = rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.mode === 'update') {
        selected.forEach((row) => Object.assign(row, this.values1))
        return { data: selected, error: null }
      }
      if (this.rangeBounds) selected = selected.slice(this.rangeBounds[0], this.rangeBounds[1] + 1)
      if (this.limitCount !== null) selected = selected.slice(0, this.limitCount)
      return { data: selected, error: null }
    }
    then<A, B>(onfulfilled?: ((value: { data: unknown; error: { code?: string; message: string } | null }) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null) {
      return this.exec().then(onfulfilled, onrejected)
    }
    maybeSingle() { return this.exec().then((result) => ({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error })) }
    single() {
      return this.exec().then((result) => {
        const first = Array.isArray(result.data) ? result.data[0] ?? null : result.data
        return { data: first, error: result.error ?? (first ? null : { message: 'not found' }) }
      })
    }
  }
  return {
    from: (table: string) => new Query(table),
    rpc: async () => ({ data: eligibleChannelCredential, error: null }),
  }
}

const USER = 'user-1'
const VIDEO = '5f1a3b1e-0000-4000-8000-000000000001'

function baseDb(overrides: Partial<Db> = {}): Db {
  return {
    videos: [{ id: VIDEO, channel_id: 'channel-1', youtube_video_id: 'abcdefghijk', video_url: 'https://www.youtube.com/watch?v=abcdefghijk', duration_seconds: 300, availability_status: 'available' }],
    user_channels: [{ id: 'uc-1', user_id: USER, channel_id: 'channel-1', is_active: true }],
    user_provider_credentials: [{ id: 'cred-1', user_id: USER, provider: 'gemini', is_configured: true, is_valid: true }],
    transcription_profile: [{ id: true, model: 'gemini-3.1-flash-lite', thinking_level: 'minimal' }],
    transcriptions: [],
    transcription_parts: [],
    transcription_phrases: [],
    jobs: [],
    ...overrides,
  }
}

function setup(overrides: Partial<Db> = {}, eligibleChannelCredential = true) {
  const db = baseDb(overrides)
  const client = createFakeClient(db, eligibleChannelCredential)
  return { db, supabase: client as unknown as AppSupabaseClient, admin: client as never }
}

describe('richiesta di trascrizione', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rifiuta un video inesistente e chi non segue il canale', async () => {
    const missing = setup({ videos: [] })
    await expect(requestTranscriptionForUser({ ...missing, userId: USER, videoId: VIDEO })).rejects.toMatchObject({ type: 'not_found', statusCode: 404 })

    const notFollower = setup({ user_channels: [] })
    await expect(requestTranscriptionForUser({ ...notFollower, userId: USER, videoId: VIDEO })).rejects.toMatchObject({ type: 'forbidden', statusCode: 403 })
    expect(notFollower.db.jobs).toHaveLength(0)
    expect(notFollower.db.transcriptions).toHaveLength(0)
  })

  it('senza chiave Gemini valida risponde con codice stabile e non crea nulla', async () => {
    for (const credentials of [[], [{ id: 'c', user_id: USER, provider: 'gemini', is_configured: true, is_valid: false }]]) {
      const ctx = setup({ user_provider_credentials: credentials })
      const error = await requestTranscriptionForUser({ ...ctx, userId: USER, videoId: VIDEO }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ statusCode: 403, context: { code: 'GEMINI_KEY_REQUIRED' } })
      expect(ctx.db.transcriptions).toHaveLength(0)
      expect(ctx.db.jobs).toHaveLength(0)
    }
  })

  it('riusa il canonico esistente senza chiave e senza creare job', async () => {
    for (const status of ['complete', 'needs_review']) {
      const ctx = setup({
        user_provider_credentials: [],
        transcriptions: [{ id: 't-1', video_id: VIDEO, status }],
      })
      const result = await requestTranscriptionForUser({ ...ctx, userId: USER, videoId: VIDEO })
      expect(result).toEqual({ jobId: null, transcriptionStatus: status, shouldRun: false, reused: true })
      expect(ctx.db.jobs).toHaveLength(0)
    }
  })

  it('crea trascrizione, parti da 120 s e job con la chiave di chi richiede', async () => {
    const ctx = setup()
    const result = await requestTranscriptionForUser({ ...ctx, userId: USER, videoId: VIDEO })

    expect(result).toMatchObject({ transcriptionStatus: 'pending', shouldRun: true, reused: false })
    expect(ctx.db.transcriptions).toEqual([expect.objectContaining({
      video_id: VIDEO, status: 'pending', model: 'gemini-3.1-flash-lite', thinking_level: 'minimal', requested_by_user_id: USER,
    })])
    expect(ctx.db.transcription_parts.map((part) => [part.position, part.start_seconds, part.end_seconds])).toEqual([
      [0, 0, 120], [1, 120, 240], [2, 240, 300],
    ])
    expect(ctx.db.jobs).toEqual([expect.objectContaining({
      id: result.jobId,
      job_type: 'transcribe_video',
      status: 'pending',
      created_by_user_id: USER,
      payload: { videoId: VIDEO, transcriptionId: ctx.db.transcriptions[0].id, requestedByUserId: USER, credentialOwnerUserId: USER, channelId: 'channel-1' },
    })])
  })

  it('non duplica il job attivo: lease valida non rilancia, lease scaduta riprende', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()
    const live = setup({
      transcriptions: [{ id: 't-1', video_id: VIDEO, status: 'running' }],
      jobs: [{ id: 'job-live', job_type: 'transcribe_video', status: 'running', lease_expires_at: future, payload: { videoId: VIDEO } }],
    })
    expect(await requestTranscriptionForUser({ ...live, userId: USER, videoId: VIDEO }))
      .toMatchObject({ jobId: 'job-live', shouldRun: false })

    const stalled = setup({
      transcriptions: [{ id: 't-1', video_id: VIDEO, status: 'running' }],
      jobs: [{ id: 'job-old', job_type: 'transcribe_video', status: 'running', lease_expires_at: past, payload: { videoId: VIDEO } }],
    })
    expect(await requestTranscriptionForUser({ ...stalled, userId: USER, videoId: VIDEO }))
      .toMatchObject({ jobId: 'job-old', shouldRun: true })
    expect(stalled.db.jobs).toHaveLength(1)
  })

  it('segna non disponibile un video non trascrivibile', async () => {
    const ctx = setup({ videos: [{ id: VIDEO, channel_id: 'channel-1', youtube_video_id: 'abcdefghijk', video_url: 'x', duration_seconds: 300, availability_status: 'private' }] })
    await expect(requestTranscriptionForUser({ ...ctx, userId: USER, videoId: VIDEO }))
      .rejects.toMatchObject({ statusCode: 422, context: { code: 'TRANSCRIPTION_UNAVAILABLE' } })
    expect(ctx.db.transcriptions).toEqual([expect.objectContaining({ status: 'unavailable' })])
    expect(ctx.db.jobs).toHaveLength(0)
  })
})

describe('stato della trascrizione per la pagina', () => {
  it('carica tutte le frasi oltre il limite di 1000 righe con link al minuto', async () => {
    const phrases = Array.from({ length: 1500 }, (_, index) => ({
      transcription_id: 't-1', position: index, start_seconds: index * 2, text: `frase ${index}`, doubtful_time: index === 7,
    }))
    const ctx = setup({
      transcriptions: [{ id: 't-1', video_id: VIDEO, status: 'needs_review', language_code: 'it', doubtful_phrase_count: 1, missing_part_count: 0 }],
      transcription_parts: [{ transcription_id: 't-1', status: 'done' }],
      transcription_phrases: phrases,
    })
    const view = await getTranscriptionViewModel({
      supabase: ctx.supabase, admin: ctx.admin, userId: USER,
      video: { id: VIDEO, channel_id: 'channel-1', youtube_video_id: 'abcdefghijk', video_url: '' },
    })
    expect(view.state).toBe('needs_review')
    expect(view.phrases).toHaveLength(1500)
    expect(view.phrases[7]).toMatchObject({ isTimeDoubtful: true, timeLabel: '0:14' })
    expect(view.phrases[61].youtubeUrl).toBe('https://www.youtube.com/watch?v=abcdefghijk&t=122s')
  })

  it('senza trascrizione e senza chiave il pulsante è bloccato con il motivo', async () => {
    const ctx = setup({ user_provider_credentials: [] })
    const view = await getTranscriptionViewModel({
      supabase: ctx.supabase, admin: ctx.admin, userId: USER,
      video: { id: VIDEO, channel_id: 'channel-1', youtube_video_id: 'abcdefghijk', video_url: '' },
    })
    expect(view).toMatchObject({ state: 'absent', canRequest: false, requestBlockedReason: 'gemini_key_missing', phrases: [] })
  })

  it('in corso con job fermo segnala la ripresa e mostra l’avanzamento', async () => {
    const ctx = setup({
      transcriptions: [{ id: 't-1', video_id: VIDEO, status: 'running', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 }],
      transcription_parts: [{ transcription_id: 't-1', status: 'done' }, { transcription_id: 't-1', status: 'pending' }],
    })
    const view = await getTranscriptionViewModel({
      supabase: ctx.supabase, admin: ctx.admin, userId: USER,
      video: { id: VIDEO, channel_id: 'channel-1', youtube_video_id: 'abcdefghijk', video_url: '' },
    })
    expect(view).toMatchObject({ state: 'running', needsResume: true, progress: { doneParts: 1, totalParts: 2 } })
  })

  it('un pending mai reclamato senza parti fatte attende una chiave eleggibile del canale', async () => {
    const ctx = setup({
      user_provider_credentials: [],
      transcriptions: [{ id: 't-1', video_id: VIDEO, status: 'pending', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 }],
      transcription_parts: [{ transcription_id: 't-1', status: 'pending' }, { transcription_id: 't-1', status: 'pending' }],
      jobs: [{ id: 'job-1', job_type: 'transcribe_video', status: 'pending', started_at: null, lease_expires_at: null, payload: { videoId: VIDEO, channelId: 'channel-1' } }],
    }, false)

    const view = await getTranscriptionViewModel({
      supabase: ctx.supabase, admin: ctx.admin, userId: USER,
      video: { id: VIDEO, channel_id: 'channel-1', youtube_video_id: 'abcdefghijk', video_url: '' },
    })

    expect(view).toMatchObject({ state: 'waiting_for_key', progress: null, requestBlockedReason: 'gemini_key_missing' })
  })

  it('un pending mai reclamato resta in corso quando il canale ha una chiave eleggibile', async () => {
    const ctx = setup({
      transcriptions: [{ id: 't-1', video_id: VIDEO, status: 'pending', language_code: null, doubtful_phrase_count: 0, missing_part_count: 0 }],
      transcription_parts: [{ transcription_id: 't-1', status: 'pending' }],
      jobs: [{ id: 'job-1', job_type: 'transcribe_video', status: 'pending', started_at: null, lease_expires_at: null, payload: { videoId: VIDEO, channelId: 'channel-1' } }],
    }, true)

    const view = await getTranscriptionViewModel({
      supabase: ctx.supabase, admin: ctx.admin, userId: USER,
      video: { id: VIDEO, channel_id: 'channel-1', youtube_video_id: 'abcdefghijk', video_url: '' },
    })

    expect(view).toMatchObject({ state: 'running', progress: { doneParts: 0, totalParts: 1 } })
  })

  it('loadFollowedVideo restituisce il video quando il canale è seguito', async () => {
    const ctx = setup()
    await expect(loadFollowedVideo({ supabase: ctx.supabase, userId: USER, videoId: VIDEO })).resolves.toMatchObject({ id: VIDEO })
  })
})
