/* Commento didattico:
 * Scopo del file: testa scelta traccia, fetch/store idempotente, fallback e diagnostica degli errori transcript.
 * Moduli richiamati: service video-transcripts con fetch upstream e client Supabase simulati.
 * Flusso: usa risposte sintetiche del player/timedtext per verificare stati, reason sanitizzati e cleanup fixture.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAndStoreForVideo,
  fetchMainTranscript,
  pickMainTrack,
  runTranscriptFixture,
  TranscriptFixtureCleanupError,
  TranscriptFixtureRunError,
} from '@/lib/services/video-transcripts'

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    json: async () => payload,
  } as Response
}

describe('pickMainTrack', () => {
  it('preferisce la traccia manuale standard alla ASR nella stessa lingua', () => {
    const track = pickMainTrack([
      { baseUrl: 'https://asr', languageCode: 'it', kind: 'asr', vssId: 'a.it' },
      { baseUrl: 'https://manual', languageCode: 'it', kind: 'standard', vssId: 'it' },
    ])

    expect(track?.baseUrl).toBe('https://manual')
  })

  it('usa la ASR quando non esiste una traccia manuale', () => {
    const track = pickMainTrack([
      { baseUrl: 'https://asr', languageCode: 'it', kind: 'asr', vssId: 'a.it' },
    ])

    expect(track?.baseUrl).toBe('https://asr')
  })

  it('ripiega su en quando le tracce non dichiarano il kind', () => {
    const track = pickMainTrack([
      { baseUrl: 'https://en', languageCode: 'en' },
    ])

    expect(track?.languageCode).toBe('en')
  })

  it('ritorna null senza tracce utilizzabili', () => {
    expect(pickMainTrack([])).toBeNull()
    expect(pickMainTrack([{ baseUrl: '', languageCode: 'it' }])).toBeNull()
  })
})

describe('fetchMainTranscript', () => {
  beforeEach(() => {
    process.env.YOUTUBEI_API_KEY = 'test-key'
  })

  it('sceglie la manuale e compone testo e segmenti dal json3', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://www.youtube.com/api/timedtext?v=yt-1&lang=it', languageCode: 'it', kind: 'asr', vssId: 'a.it' },
              { baseUrl: 'https://www.youtube.com/api/timedtext?v=yt-1&lang=it', languageCode: 'it', kind: 'standard', vssId: 'it' },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        events: [
          { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Ciao ' }, { utf8: 'mondo' }] },
          { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'Fine' }] },
        ],
      }))

    const result = await fetchMainTranscript('yt-1', fetchMock as unknown as typeof fetch)

    expect(result.transcript?.language_code).toBe('it')
    expect(result.transcript?.kind).toBe('standard')
    expect(result.transcript?.is_asr).toBe(false)
    expect(result.transcript?.text).toBe('Ciao mondo\nFine')
    expect(result.transcript?.segments).toHaveLength(2)
    expect(result.diagnostics).toContain('ANDROID')
    // Mai traduzioni: nessun parametro tlang nell'URL timedtext.
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain('tlang')
  })

  it('ritorna transcript null quando nessun client espone captionTracks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))

    const result = await fetchMainTranscript('yt-2', fetchMock as unknown as typeof fetch)

    expect(result.transcript).toBeNull()
    expect(result.diagnostics).toContain('ANDROID')
    expect(result.diagnostics).toContain('TVHTML5')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fallback: usa la traccia del secondo client quando il primo non ha tracce', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))
      .mockResolvedValueOnce(jsonResponse({
        playabilityStatus: { status: 'OK' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://www.youtube.com/api/timedtext?v=yt-fallback&lang=it', languageCode: 'it', kind: 'asr', vssId: 'a.it' },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        events: [
          { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Prova fallback' }] },
        ],
      }))

    const result = await fetchMainTranscript('yt-fallback', fetchMock as unknown as typeof fetch)

    expect(result.transcript?.language_code).toBe('it')
    expect(result.transcript?.is_asr).toBe(true)
    expect(result.transcript?.text).toBe('Prova fallback')
    expect(result.diagnosticAttempts.map((attempt) => attempt.outcome)).toEqual(['no_usable_track', 'fetched'])
    expect(result.diagnostics).toContain('ANDROID')
    expect(result.diagnostics).toContain('TVHTML5')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('fetchAndStoreForVideo idempotenza', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    process.env.YOUTUBEI_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function buildAdminMock(existing: Array<{ transcript_status: string }>) {
    const eqSelect = vi.fn().mockResolvedValue({ data: existing, error: null })
    const select = vi.fn(() => ({ eq: eqSelect }))
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const insert = vi.fn().mockResolvedValue({ error: null })
    const eqUpdate = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn((payload: Record<string, unknown>) => ({ eq: eqUpdate }))
    const admin = { from: vi.fn(() => ({ select, upsert, update, insert })) }
    return { admin, eqSelect, upsert, update, insert, eqUpdate }
  }

  it('salta il fetch quando la riga e gia fetched senza chiamare la rete', async () => {
    const { admin } = buildAdminMock([{ transcript_status: 'fetched' }])
    const fetchMock = vi.fn()

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-1',
      'yt-fetched',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'skipped' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('salta il fetch anche per le righe legacy_missing del backfill', async () => {
    const { admin } = buildAdminMock([{ transcript_status: 'legacy_missing' }])
    const fetchMock = vi.fn()

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-2',
      'yt-legacy',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'skipped' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marca missing quando il video non ha tracce, senza testo salvato', async () => {
    const { admin, upsert, update } = buildAdminMock([])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-3',
      'yt-notracks',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'missing' })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('missing salva in error_details la diagnostica con entrambi i client', async () => {
    const { admin, update } = buildAdminMock([])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-4',
      'yt-nodiag',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'missing' })
    const errorDetails = String(update.mock.calls[0]?.[0]?.error_details ?? '')
    expect(errorDetails).toContain('ANDROID')
    expect(errorDetails).toContain('TVHTML5')
  })

  it('salva reason e subreason per client senza conservare il payload player', async () => {
    const { admin, insert } = buildAdminMock([])
    const playerResponse = {
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm this request is allowed',
        errorScreen: {
          errorCode: 'LOGIN_REQUIRED',
          playerErrorMessageRenderer: {
            reason: { simpleText: 'Sign in to confirm this request is allowed' },
            subreason: { simpleText: 'Diagnostic-only subreason' },
          },
        },
      },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(playerResponse))
      .mockResolvedValueOnce(jsonResponse(playerResponse))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-diagnostic',
      'yt-diagnostic',
      fetchMock as unknown as typeof fetch,
      'request-id-test'
    )

    expect(result).toEqual({ outcome: 'missing' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      request_id: 'request-id-test',
      client_name: 'ANDROID',
      playability_status: 'LOGIN_REQUIRED',
      player_reason: 'Sign in to confirm this request is allowed',
      player_subreason: 'Diagnostic-only subreason',
      player_error_code: 'LOGIN_REQUIRED',
      track_count: 0,
    })
    expect(rows[1]?.client_name).toBe('TVHTML5')
    expect(JSON.stringify(rows)).not.toContain('captionTracks')
    expect(JSON.stringify(rows)).not.toContain('videoId')
    const logOutput = vi.mocked(console.info).mock.calls.map(([entry]) => String(entry)).join('\n')
    expect(logOutput).not.toContain('video-uuid-diagnostic')
  })

  it('registra HTTP timedtext e conserva il comportamento failed senza salvare il body', async () => {
    const { admin, insert } = buildAdminMock([])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        playabilityStatus: { status: 'OK' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://www.youtube.com/api/timedtext?v=yt-http-error&lang=it&sig=private', languageCode: 'it', kind: 'asr' },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ privateResponseBody: 'must-not-be-stored' }, false, 503))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-http',
      'yt-http-error',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      stage: 'timedtext',
      outcome: 'timedtext_error',
      timedtext_http_status: 503,
      error_code: 'HTTP_503',
    })
    expect(JSON.stringify(rows)).not.toContain('privateResponseBody')
    expect(JSON.stringify(rows)).not.toContain('sig=private')
    const logOutput = vi.mocked(console.info).mock.calls.map(([entry]) => String(entry)).join('\n')
    expect(logOutput).not.toContain('sig=private')
    expect(logOutput).not.toContain('yt-http-error')
  })

  it('estrae error code/message da HTTP player senza conservare URL o query', async () => {
    const { admin, insert } = buildAdminMock([])
    const errorResponse = {
      error: {
        code: 429,
        message: 'Rate limited at https://www.youtube.com/player?key=secret-key&token=secret-token',
      },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(errorResponse, false, 429))
      .mockResolvedValueOnce(jsonResponse(errorResponse, false, 429))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-player-http',
      'yt-player-http',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({
      outcome: 'http_error',
      player_http_status: 429,
      player_error_code: '429',
      error_code: '429',
    })
    expect(JSON.stringify(rows)).not.toContain('youtube.com')
    expect(JSON.stringify(rows)).not.toContain('secret-key')
    expect(JSON.stringify(rows)).not.toContain('secret-token')
    const logOutput = vi.mocked(console.info).mock.calls.map(([entry]) => String(entry)).join('\n')
    expect(logOutput).not.toContain('youtube.com')
    expect(logOutput).not.toContain('secret-key')
    expect(logOutput).not.toContain('secret-token')
  })

  it('registra timeout/rete senza salvare URL firmati contenuti nell errore', async () => {
    const { admin, insert } = buildAdminMock([])
    const networkError = Object.assign(
      new TypeError('fetch failed https://www.youtube.com/player?key=test-key&sig=private-signature'),
      { cause: { code: 'ECONNRESET' } }
    )
    const fetchMock = vi.fn().mockRejectedValue(networkError)

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-network',
      'yt-network',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ outcome: 'network_error', error_code: 'ECONNRESET' })
    expect(JSON.stringify(rows)).not.toContain('youtube.com')
    expect(JSON.stringify(rows)).not.toContain('test-key')
    expect(JSON.stringify(rows)).not.toContain('private-signature')
  })

  it.each([
    { reason: 'Diagnostic reason one', subreason: 'Diagnostic subreason one' },
    { reason: 'Diagnostic reason two', subreason: 'Diagnostic subreason two' },
  ])('preserva distintamente reason LOGIN_REQUIRED senza dedurne la causa ($reason)', async ({ reason, subreason }) => {
    const { admin, insert } = buildAdminMock([])
    const playerResponse = {
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason,
        errorScreen: {
          playerErrorMessageRenderer: {
            reason: { simpleText: reason },
            subreason: { simpleText: subreason },
          },
        },
      },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(playerResponse))
      .mockResolvedValueOnce(jsonResponse(playerResponse))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-login-required',
      'yt-login-required',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'missing' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.outcome)).toEqual(['playability_blocked', 'playability_blocked'])
    expect(rows.map((row) => row.player_reason)).toEqual([reason, reason])
    expect(rows.map((row) => row.player_subreason)).toEqual([subreason, subreason])
    expect(rows.map((row) => row.client_name)).toEqual(['ANDROID', 'TVHTML5'])
  })

  it('distingue HTTP 503 del player dal successivo fallback senza tracce', async () => {
    const { admin, insert } = buildAdminMock([])
    const playerError = {
      error: {
        code: 503,
        message: 'temporary upstream failure https://www.youtube.com/player?key=diagnostic-key',
      },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(playerError, false, 503))
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-player-503',
      'yt-player-503',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'missing' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      client_name: 'ANDROID',
      stage: 'player',
      outcome: 'http_error',
      player_http_status: 503,
      player_error_code: '503',
      error_code: '503',
    })
    expect(rows[1]).toMatchObject({
      client_name: 'TVHTML5',
      stage: 'player',
      outcome: 'no_usable_track',
      playability_status: 'OK',
    })
    expect(JSON.stringify(rows)).not.toContain('youtube.com')
    expect(JSON.stringify(rows)).not.toContain('diagnostic-key')
  })

  it('classifica il timeout durante il fetch player senza confonderlo con un errore HTTP', async () => {
    const { admin, insert } = buildAdminMock([])
    const timeoutError = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockRejectedValueOnce(timeoutError)

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-player-timeout',
      'yt-player-timeout',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.outcome)).toEqual(['timeout', 'timeout'])
    expect(rows.map((row) => row.error_type)).toEqual(['TimeoutError', 'TimeoutError'])
    expect(rows.every((row) => row.player_http_status === null)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('youtube.com')
  })

  it('registra JSON player non valido senza salvare estratti del body', async () => {
    const { admin, insert } = buildAdminMock([])
    const invalidJson = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: vi.fn().mockRejectedValue(new SyntaxError('invalid json; private body excerpt')),
    } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValue(invalidJson)

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-invalid-json',
      'yt-invalid-json',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ outcome: 'invalid_json', error_code: 'PLAYER_INVALID_JSON' })
    expect(JSON.stringify(rows)).not.toContain('private body excerpt')
  })

  it('registra risposta player JSON null come forma non valida invece di perdere il diagnostico', async () => {
    const { admin, insert } = buildAdminMock([])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse(null))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-player-null',
      'yt-player-null',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'invalid_json', error_code: 'PLAYER_INVALID_SHAPE' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('distingue captionTracks con forma non valida dall array vuoto', async () => {
    const { admin, insert } = buildAdminMock([])
    const response = jsonResponse({
      playabilityStatus: { status: 'OK' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: { unexpected: true } } },
    })
    const fetchMock = vi.fn().mockResolvedValue(response)

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-tracks-shape',
      'yt-tracks-shape',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      outcome: 'invalid_json',
      player_error_code: null,
      usable_track_count: 0,
      error_code: 'CAPTION_TRACKS_INVALID_SHAPE',
    })
    expect(rows[0]?.track_count).toBeNull()
  })

  it('registra schema timedtext malformato senza conservare il body', async () => {
    const { admin, insert } = buildAdminMock([])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        playabilityStatus: { status: 'OK' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://www.youtube.com/api/timedtext?v=yt-bad-json&lang=it', languageCode: 'it', kind: 'asr' },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse(null))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-timedtext-json',
      'yt-timedtext-json',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'failed' })
    const rows = insert.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ outcome: 'invalid_json', error_code: 'TIMEDTEXT_INVALID_SHAPE' })
  })

  it('un errore di persistenza diagnostica è fail-open e non cambia missing', async () => {
    const { admin, insert, update } = buildAdminMock([])
    insert.mockResolvedValue({ error: { code: '42P01' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))

    const result = await fetchAndStoreForVideo(
      admin as never,
      'video-uuid-diagnostic-db-error',
      'yt-diagnostic-db-error',
      fetchMock as unknown as typeof fetch
    )

    expect(result).toEqual({ outcome: 'missing' })
    expect(update.mock.calls[0]?.[0]?.transcript_status).toBe('missing')
    expect(console.error).toHaveBeenCalledOnce()
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).not.toContain('test-key')
  })
})

describe('runTranscriptFixture', () => {
  const fixtureVideoId = 'Abcdefghijk'
  const fixtureRow = {
    id: 'transcript-row-fixture',
    video_id: 'video-row-fixture',
    youtube_video_id: fixtureVideoId,
  }

  beforeEach(() => {
    process.env.YOUTUBEI_API_KEY = 'test-key'
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function buildAdminMock(options: {
    pendingQueryError?: boolean
    cleanupFailure?: boolean
    initialStatus?: string
  } = {}) {
    const calls: Array<{
      table: string
      operation: string
      columns?: string
      payload?: Record<string, unknown>
      filters: Record<string, string>
    }> = []
    let fixturePendingUpdates = 0

    const admin = {
      from: vi.fn((table: string) => {
        const call: (typeof calls)[number] = { table, operation: 'select', filters: {} }
        calls.push(call)
        const result = () => {
          if (table === 'transcript_fetch_diagnostics') return { data: null, error: null }
          if (call.operation === 'update') {
            if (call.payload?.transcript_status === 'pending') {
              fixturePendingUpdates += 1
              if (options.cleanupFailure && fixturePendingUpdates === 2) {
                return { data: null, error: { code: 'PRIVATE_DB_ERROR', message: 'private cleanup details' } }
              }
              return { data: { id: fixtureRow.id }, error: null }
            }
            return { data: null, error: null }
          }
          if (call.columns === 'id,video_id,youtube_video_id,transcript_status') {
            return {
              data: { ...fixtureRow, transcript_status: options.initialStatus ?? 'fetched' },
              error: null,
            }
          }
          if (call.columns === 'video_id,youtube_video_id') {
            return options.pendingQueryError
              ? { data: null, error: { code: 'PRIVATE_DB_ERROR', message: 'private query details' } }
              : { data: [fixtureRow], error: null }
          }
          if (call.columns === 'transcript_status') {
            return { data: [{ transcript_status: 'pending' }], error: null }
          }
          return { data: null, error: null }
        }

        const query = {
          select: vi.fn((columns?: string) => {
            call.columns = columns
            return query
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            call.operation = 'update'
            call.payload = payload
            return query
          }),
          eq: vi.fn((column: string, value: string) => {
            call.filters[column] = value
            return query
          }),
          maybeSingle: vi.fn(async () => result()),
          limit: vi.fn(async () => result()),
          insert: vi.fn(async () => ({ error: null })),
          then: (resolve: (value: ReturnType<typeof result>) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject),
        }
        return query
      }),
    }

    return { admin, calls }
  }

  function emptyTranscriptFetch() {
    return vi.fn()
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))
      .mockResolvedValueOnce(jsonResponse({ playabilityStatus: { status: 'OK' } }))
  }

  function fetchedTranscriptFetch() {
    return vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        playabilityStatus: { status: 'OK' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://www.youtube.com/api/timedtext?v=fixture&lang=it', languageCode: 'it' },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'fixture-private-transcript' }] }],
      }))
  }

  it('pulisce il testo fetched e tocca esclusivamente la riga fixture', async () => {
    const { admin, calls } = buildAdminMock()
    const result = await runTranscriptFixture(fixtureVideoId, fetchedTranscriptFetch() as unknown as typeof fetch, {
      admin: admin as never,
      requestId: 'fixture-request',
    })

    expect(result).toEqual({
      success: true,
      checked: 1,
      fetched: 1,
      missing: 0,
      failed: 0,
      skipped: 0,
      cleanup: 'completed',
    })
    expect(JSON.stringify(result)).not.toContain('fixture-private-transcript')
    const pendingQuery = calls.find((call) => call.columns === 'video_id,youtube_video_id')
    expect(pendingQuery?.filters).toMatchObject({
      transcript_status: 'pending',
      youtube_video_id: fixtureVideoId,
      id: fixtureRow.id,
    })
    const updates = calls.filter((call) => call.table === 'video_transcripts' && call.operation === 'update')
    expect(updates.every((call) => call.filters.id === fixtureRow.id)).toBe(true)
    expect(updates.every((call) => call.filters.youtube_video_id === fixtureVideoId)).toBe(true)
    expect(updates.some((call) => call.payload?.transcript_status === 'fetched')).toBe(true)
    const resetAndCleanup = updates.filter((call) => call.payload?.transcript_status === 'pending')
    expect(resetAndCleanup).toHaveLength(2)
    for (const update of resetAndCleanup) {
      expect(update.payload).toMatchObject({
        language_code: 'unknown',
        kind: 'unknown',
        is_asr: null,
        transcript_text: null,
        segments: null,
        fetched_at: null,
        error_details: null,
      })
    }
  })

  it('esegue comunque il cleanup quando il service filtrato fallisce', async () => {
    const { admin, calls } = buildAdminMock({ pendingQueryError: true })

    await expect(runTranscriptFixture(fixtureVideoId, fetch, { admin: admin as never }))
      .rejects.toBeInstanceOf(TranscriptFixtureRunError)

    const resetAndCleanup = calls.filter((call) => call.payload?.transcript_status === 'pending')
    expect(resetAndCleanup).toHaveLength(2)
    expect(resetAndCleanup.every((call) => call.filters.id === fixtureRow.id)).toBe(true)
    for (const update of resetAndCleanup) {
      expect(update.payload).toMatchObject({
        language_code: 'unknown',
        kind: 'unknown',
        is_asr: null,
        transcript_text: null,
        segments: null,
        fetched_at: null,
        error_details: null,
      })
    }
  })

  it('rifiuta legacy_missing prima di qualunque aggiornamento', async () => {
    const { admin, calls } = buildAdminMock({ initialStatus: 'legacy_missing' })
    const fetchMock = vi.fn()

    await expect(runTranscriptFixture(fixtureVideoId, fetchMock as unknown as typeof fetch, {
      admin: admin as never,
    })).rejects.toBeInstanceOf(TranscriptFixtureRunError)

    expect(calls.filter((call) => call.operation === 'update')).toHaveLength(0)
    expect(calls.some((call) => call.columns === 'video_id,youtube_video_id')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fallisce in modo esplicito e senza dettagli DB quando il cleanup non riesce', async () => {
    const { admin } = buildAdminMock({ cleanupFailure: true })

    const error = await runTranscriptFixture(fixtureVideoId, emptyTranscriptFetch() as unknown as typeof fetch, {
      admin: admin as never,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TranscriptFixtureCleanupError)
    expect((error as Error).message).toBe('Fixture transcript cleanup failed')
    expect((error as Error).message).not.toContain('private cleanup details')
  })
})
