/* Commento didattico:
 * Scopo del file: testa scelta traccia trascrizione (manuale > ASR > en) e idempotenza fetch/store.
 * Moduli richiamati: service video-transcripts con fetch e client Supabase simulati.
 * Flusso: mocka player/timedtext e catena Supabase, verifica lingua scelta e skip su riga fetched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAndStoreForVideo,
  fetchMainTranscript,
  pickMainTrack,
} from '@/lib/services/video-transcripts'

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => payload } as Response
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
              { baseUrl: 'https://asr', languageCode: 'it', kind: 'asr', vssId: 'a.it' },
              { baseUrl: 'https://manual', languageCode: 'it', kind: 'standard', vssId: 'it' },
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
              { baseUrl: 'https://it-asr', languageCode: 'it', kind: 'asr', vssId: 'a.it' },
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
    expect(result.diagnostics).toContain('ANDROID')
    expect(result.diagnostics).toContain('TVHTML5')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('fetchAndStoreForVideo idempotenza', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.YOUTUBEI_API_KEY = 'test-key'
  })

  function buildAdminMock(existing: Array<{ transcript_status: string }>) {
    const eqSelect = vi.fn().mockResolvedValue({ data: existing, error: null })
    const select = vi.fn(() => ({ eq: eqSelect }))
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const eqUpdate = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn((payload: Record<string, unknown>) => ({ eq: eqUpdate }))
    const admin = { from: vi.fn(() => ({ select, upsert, update })) }
    return { admin, eqSelect, upsert, update, eqUpdate }
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
})
