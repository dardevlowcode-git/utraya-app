/* Commento didattico:
 * Scopo: verifica offline la selezione dei video e il contratto della singola chiamata Gemini.
 * Moduli richiamati: service temporaneo di analisi Gemini e fetch simulato da Vitest.
 * Flusso: esclude contenuti già esistenti e controlla modello, URL, store=false, limite output e assenza di retry.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isGeminiProbeAuthorized,
  makeShortSummary,
  requestGeminiVideoSummary,
  selectEligibleProbeVideos,
} from './gemini-analysis-probe'

const videos = [
  { id: 'v1', youtube_video_id: 'youtube-id-0001', video_url: 'https://www.youtube.com/watch?v=youtube-id-0001', published_at: '2026-09-28T00:00:00Z', availability_status: 'available' as const, video_type: 'standard' as const },
  { id: 'v2', youtube_video_id: 'youtube-id-0002', video_url: 'https://www.youtube.com/watch?v=youtube-id-0002', published_at: '2026-09-27T00:00:00Z', availability_status: 'available' as const, video_type: 'standard' as const },
  { id: 'v3', youtube_video_id: 'youtube-id-0003', video_url: 'https://www.youtube.com/watch?v=youtube-id-0003', published_at: '2026-09-26T00:00:00Z', availability_status: 'available' as const, video_type: 'standard' as const },
]

describe('selectEligibleProbeVideos', () => {
  it('excludes any video that already has an analysis or localized summary', () => {
    const selected = selectEligibleProbeVideos(videos, new Set(['v1']), new Set(['v2']))

    expect(selected.map((video) => video.id)).toEqual(['v3'])
  })

  it('returns at most two distinct unsummarized videos', () => {
    const selected = selectEligibleProbeVideos(videos, new Set(), new Set())

    expect(selected.map((video) => video.id)).toEqual(['v1', 'v2'])
    expect(new Set(selected.map((video) => video.id)).size).toBe(2)
  })
})

describe('requestGeminiVideoSummary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the selected video once to Gemini 3.5 without provider-side storage', async () => {
    const apiKey = 'probe-test-key-never-return-this'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: '[00:00] Introduzione.\n[01:10] Conclusione.' }] }],
      usage: { total_input_tokens: 100, total_output_tokens: 20, total_tokens: 120 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestGeminiVideoSummary({ apiKey, video: videos[0], language: 'it' })
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body)) as {
      model: string
      store: boolean
      generation_config: { max_output_tokens: number }
      input: Array<{ type: string; uri?: string }>
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body.model).toBe('gemini-3.5-flash-lite')
    expect(body.store).toBe(false)
    expect(body.generation_config.max_output_tokens).toBe(400)
    expect(body.input.find((part) => part.type === 'video')?.uri).toBe(videos[0].video_url)
    expect(result).toMatchObject({ ok: true, videoId: videos[0].youtube_video_id, timestampCount: 2 })
    expect(JSON.stringify(result)).not.toContain(apiKey)
    expect(makeShortSummary('[00:00] La prima frase.\n[01:10] Un’altra idea.')).toBe('La prima frase.')
  })

  it('does not retry a provider quota response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestGeminiVideoSummary({ apiKey: 'probe-test-key', video: videos[1], language: 'it' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, httpStatus: 429, providerErrorCode: 'RESOURCE_EXHAUSTED' })
  })

  it('rejects non-YouTube or mismatched video URLs before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestGeminiVideoSummary({
      apiKey: 'probe-test-key',
      video: { ...videos[0], video_url: 'https://example.org/watch?v=youtube-id-0001' },
      language: 'it',
    })

    expect(result).toMatchObject({ ok: false, failure: 'invalid_video_url' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('isGeminiProbeAuthorized', () => {
  const envName = 'GEMINI_DEV_ANALYSIS_TOKEN_20260928_0140'
  const previousValue = process.env[envName]

  afterEach(() => {
    if (previousValue === undefined) delete process.env[envName]
    else process.env[envName] = previousValue
  })

  it('accepts only a matching token with a short future expiry', () => {
    const token = `${Math.floor(Date.now() / 1000) + 300}.${'A'.repeat(43)}`
    process.env[envName] = token

    expect(isGeminiProbeAuthorized(new Request('https://dev.utraya.com', {
      headers: { authorization: `Bearer ${token}` },
    }))).toBe(true)
    expect(isGeminiProbeAuthorized(new Request('https://dev.utraya.com', {
      headers: { authorization: `Bearer ${token}x` },
    }))).toBe(false)
  })

  it('rejects expired and overlong tokens', () => {
    const expiredToken = `${Math.floor(Date.now() / 1000) - 1}.${'B'.repeat(43)}`
    process.env[envName] = expiredToken
    expect(isGeminiProbeAuthorized(new Request('https://dev.utraya.com', {
      headers: { authorization: `Bearer ${expiredToken}` },
    }))).toBe(false)

    const longLivedToken = `${Math.floor(Date.now() / 1000) + 901}.${'C'.repeat(43)}`
    process.env[envName] = longLivedToken
    expect(isGeminiProbeAuthorized(new Request('https://dev.utraya.com', {
      headers: { authorization: `Bearer ${longLivedToken}` },
    }))).toBe(false)
  })
})
