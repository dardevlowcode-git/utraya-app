/* Commento didattico:
 * Scopo del file: testa scelta traccia trascrizione (manuale > ASR > en) e idempotenza fetch/store.
 * Moduli richiamati: service video-transcripts con fetch e client Supabase simulati.
 * Flusso: mocka player/timedtext e catena Supabase, verifica lingua scelta e skip su riga fetched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAndStoreForVideo,
  fetchMainTranscript,
  pickMainTrack,
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
