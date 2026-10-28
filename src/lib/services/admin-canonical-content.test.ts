import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClientMock, getAdminSessionMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getAdminSessionMock: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({ getAdminSession: getAdminSessionMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))

import {
  loadAdminCanonicalContentDetail,
  loadAdminCanonicalVideos,
} from './admin-canonical-content'

type QueryResult = { data: unknown; error: { message: string } | null }
type QueryTrace = { table: string; filters: Array<[string, string]>; selections: string[] }

class AdminQueryMock {
  constructor(
    private readonly result: QueryResult,
    private readonly trace: QueryTrace
  ) {}

  select(columns: string) {
    this.trace.selections.push(columns)
    return this
  }

  eq(column: string, value: string) {
    this.trace.filters.push([column, value])
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  in(column: string, values: string[]) {
    this.trace.filters.push([column, values.join(',')])
    return this
  }

  maybeSingle() {
    return Promise.resolve(this.result)
  }

  then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.result).then(resolve, reject)
  }
}

/** Installa risposte sintetiche al confine Supabase e registra tabelle/filtri richiesti. */
function useAdminDatabase(responses: Record<string, QueryResult>) {
  const traces: QueryTrace[] = []
  createAdminClientMock.mockReturnValue({
    from: (table: string) => {
      const trace = { table, filters: [], selections: [] } as QueryTrace
      traces.push(trace)
      return new AdminQueryMock(responses[table], trace)
    },
  })
  return traces
}

describe('admin canonical content service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('nega l’accesso ai contenuti senza sessione admin', async () => {
    getAdminSessionMock.mockResolvedValue(null)

    const result = await loadAdminCanonicalContentDetail({
      videoId: 'video-1',
      kind: 'transcript',
      languageCode: 'it',
    })

    expect(result).toEqual({ status: 'unauthorized' })
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('sanitizza gli errori DB con un codice stabile senza esporre dettagli interni', async () => {
    getAdminSessionMock.mockResolvedValue({ username: 'admin' })
    useAdminDatabase({
      videos: {
        data: null,
        error: { message: 'private schema admin_video_records failed at database host db.internal' },
      },
    })

    const result = await loadAdminCanonicalVideos()

    expect(result).toEqual({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Errore interno',
    })
    expect(JSON.stringify(result)).not.toContain('private schema')
    expect(JSON.stringify(result)).not.toContain('db.internal')
  })

  it('recupera il documento della lingua richiesta senza sostituirlo con un’altra lingua', async () => {
    getAdminSessionMock.mockResolvedValue({ username: 'admin' })
    const traces = useAdminDatabase({
      videos: { data: { id: 'video-1', title: 'Video scelto' }, error: null },
      video_localized_content: {
        data: {
          short_summary: 'Riassunto salvato IT',
          full_summary: 'Testo completo salvato IT',
          general_category: null,
          subcategory: null,
        },
        error: null,
      },
    })

    const result = await loadAdminCanonicalContentDetail({
      videoId: 'video-1',
      kind: 'summary',
      languageCode: 'it',
    })

    expect(result).toEqual({
      status: 'ok',
      data: {
        videoId: 'video-1',
        videoTitle: 'Video scelto',
        languageCode: 'it',
        kind: 'summary',
        fields: [
          { label: 'Riassunto breve', text: 'Riassunto salvato IT' },
          { label: 'Riassunto completo', text: 'Testo completo salvato IT' },
        ],
      },
    })
    expect(traces[1].filters).toContainEqual(['video_id', 'video-1'])
    expect(traces[1].filters).toContainEqual(['language_code', 'it'])
  })

  it('mostra soltanto le categorie già assegnate per la lingua richiesta', async () => {
    getAdminSessionMock.mockResolvedValue({ username: 'admin' })
    const traces = useAdminDatabase({
      videos: { data: { id: 'video-1', title: 'Video scelto' }, error: null },
      video_localized_content: {
        data: { general_category: 'Cultura', subcategory: 'Storia' },
        error: null,
      },
    })

    const result = await loadAdminCanonicalContentDetail({
      videoId: 'video-1',
      kind: 'category',
      languageCode: 'it',
    })

    expect(result).toMatchObject({
      status: 'ok',
      data: {
        fields: [
          { label: 'Categoria', text: 'Cultura' },
          { label: 'Sottocategoria', text: 'Storia' },
        ],
      },
    })
    expect(traces[1].selections).toEqual(['general_category, subcategory'])
    expect(traces[1].filters).toContainEqual(['language_code', 'it'])
  })

  it('legge la trascrizione Gemini (canonica) del video, non la tabella legacy', async () => {
    getAdminSessionMock.mockResolvedValue({ username: 'admin' })
    const traces = useAdminDatabase({
      videos: { data: { id: 'video-1', title: 'Video scelto' }, error: null },
      transcriptions: {
        data: {
          language_code: 'it',
          transcription_phrases: [
            { position: 1, start_seconds: 5, text: 'seconda frase' },
            { position: 0, start_seconds: 1, text: 'prima frase' },
          ],
        },
        error: null,
      },
    })

    const result = await loadAdminCanonicalContentDetail({
      videoId: 'video-1',
      kind: 'transcript',
      languageCode: 'en',
    })

    expect(result).toMatchObject({
      status: 'ok',
      data: {
        languageCode: 'it',
        kind: 'transcript',
        fields: [{ label: 'Trascrizione', text: 'prima frase\nseconda frase' }],
      },
    })
    expect(traces.map((trace) => trace.table)).toEqual(['videos', 'transcriptions'])
    expect(traces[1].filters).toContainEqual(['video_id', 'video-1'])
  })

  it('prepara link solo per campi presenti e non include i testi nella tabella admin', async () => {
    getAdminSessionMock.mockResolvedValue({ username: 'admin' })
    const traces = useAdminDatabase({
      videos: {
        data: [{
          id: 'video-1',
          title: 'Video scelto',
          youtube_video_id: 'youtube-1',
          published_at: '2026-10-10T12:00:00.000Z',
          channel: { title: 'Canale scelto' },
          localized: [{
            language_code: 'it',
            short_summary: 'Riassunto IT salvato',
            full_summary: null,
            general_category: 'Scienza',
            subcategory: 'Astronomia',
            is_admin_edited: false,
          }],
        }],
        error: null,
      },
      transcriptions: {
        data: [{
          video_id: 'video-1',
          language_code: 'en',
          transcription_phrases: [{ position: 0, start_seconds: 1, text: 'Transcript EN saved' }],
        }],
        error: null,
      },
    })

    const result = await loadAdminCanonicalVideos()

    expect(result).toMatchObject({
      status: 'ok',
      data: [{
        id: 'video-1',
        languages: ['it'],
        summaries: [
          { languageCode: 'it', href: '/admin/videos/video-1/content/summary/it' },
          { languageCode: 'en', href: null },
        ],
        categories: [
          { languageCode: 'it', href: '/admin/videos/video-1/content/category/it' },
          { languageCode: 'en', href: null },
        ],
        transcripts: [
          { languageCode: 'it', href: null },
          { languageCode: 'en', href: '/admin/videos/video-1/content/transcript/en' },
        ],
      }],
    })
    expect(JSON.stringify(result)).not.toContain('Riassunto IT salvato')
    expect(JSON.stringify(result)).not.toContain('Transcript EN saved')
    expect(traces.map((trace) => trace.table)).toEqual(['videos', 'transcriptions'])
  })
})
