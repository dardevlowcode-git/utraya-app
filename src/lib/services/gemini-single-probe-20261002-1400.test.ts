/* Commento didattico:
 * Scopo: verifica offline le guardie della prova Gemini 2026-10-02-1400 e il parser della response capture.
 * Moduli richiamati: service one-shot, controller dry-run e Vitest con fetch simulato.
 * Flusso: controlla idempotency, URL, token, singola fetch, limiti del payload, cattura e sanitizzazione dei report.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimSingleProbeInThisRuntime,
  GEMINI_SINGLE_PROBE_DEDUPE_KEY,
  GEMINI_SINGLE_PROBE_JOB_TYPE,
  GEMINI_SINGLE_PROBE_MODEL,
  GEMINI_SINGLE_PROBE_RUN_ID,
  GEMINI_SINGLE_TOKEN_ENV,
  isSingleProbeAuthorized,
  resetSingleProbeRuntimeClaimForTests,
  requestSingleVideoSummary,
  selectEligibleSingleVideo,
} from './gemini-single-probe-20261002-1400'
import {
  CAPTURE_BODY_CAP_BYTES,
  parseCurlCapture,
  STATUS_MARKER,
  summarizeBody,
} from '../../../scripts/gemini-single-probe-controller-20261002-1400.mjs'

const videos = [
  {
    id: 'video-1',
    youtube_video_id: 'youtube-id-0001',
    video_url: 'https://www.youtube.com/watch?v=youtube-id-0001',
    published_at: '2026-10-02T00:00:00Z',
    availability_status: 'available' as const,
    video_type: 'standard' as const,
  },
  {
    id: 'video-2',
    youtube_video_id: 'youtube-id-0002',
    video_url: 'https://www.youtube.com/watch?v=youtube-id-0002',
    published_at: '2026-10-01T00:00:00Z',
    availability_status: 'available' as const,
    video_type: 'standard' as const,
  },
]

function wireResponse(body: string, status = 200, extraHeader = 'x-request-id: offline-test') {
  return `HTTP/1.1 ${status} OK\r\ncontent-type: application/json\r\n${extraHeader}\r\n\r\n${body}${STATUS_MARKER}${status}`
}

describe('single probe identity and video selection', () => {
  it('usa esattamente chiave e job_type della run 2026-10-02-1400', () => {
    expect(GEMINI_SINGLE_PROBE_RUN_ID).toBe('2026-10-02-1400-singola-prova')
    expect(GEMINI_SINGLE_PROBE_DEDUPE_KEY).toBe('temporary-gemini-video-analysis:2026-10-02-1400-singola-prova')
    expect(GEMINI_SINGLE_PROBE_JOB_TYPE).toBe('gemini_dev_single_probe')
    expect(GEMINI_SINGLE_PROBE_MODEL).toBe('gemini-3.5-flash-lite')
    expect(GEMINI_SINGLE_PROBE_DEDUPE_KEY).not.toContain('2026-09-28')
  })

  it('sceglie al massimo un video disponibile non analizzato né localizzato', () => {
    expect(selectEligibleSingleVideo(videos, new Set(['video-1']), new Set(['video-2']))).toBeNull()
    expect(selectEligibleSingleVideo(videos, new Set(), new Set())?.id).toBe('video-1')
  })

  it('rifiuta URL non HTTPS o con ID diverso dai metadati', () => {
    const invalid = { ...videos[0], video_url: 'https://example.com/watch?v=youtube-id-0001' }
    const mismatched = { ...videos[0], video_url: 'https://youtu.be/youtube-id-0002' }
    expect(selectEligibleSingleVideo([invalid], new Set(), new Set())).toBeNull()
    expect(selectEligibleSingleVideo([mismatched], new Set(), new Set())).toBeNull()
  })
})

describe('one provider request', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('invia un solo POST 3.5 con store:false e massimo 400 token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Sintesi riformulata.' }] }],
          usage: { total_input_tokens: 20, total_output_tokens: 10, total_tokens: 30 },
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestSingleVideoSummary({ apiKey: 'server-only-test-key', video: videos[0] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body)) as {
      model: string
      store: boolean
      generation_config: { max_output_tokens: number }
    }
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(options.method).toBe('POST')
    expect(new Headers(options.headers).get('x-goog-api-key')).toBe('server-only-test-key')
    expect(body.model).toBe('gemini-3.5-flash-lite')
    expect(body.store).toBe(false)
    expect(body.generation_config.max_output_tokens).toBe(400)
    expect(JSON.stringify(result)).not.toContain('server-only-test-key')
  })

  it('non ritenta in caso di errore di rete', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestSingleVideoSummary({ apiKey: 'server-only-test-key', video: videos[0] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, failure: 'provider_network_or_timeout' })
  })
})

describe('temporary route authorization and latch', () => {
  afterEach(() => {
    delete process.env[GEMINI_SINGLE_TOKEN_ENV]
    resetSingleProbeRuntimeClaimForTests()
  })

  it('accetta solo un Bearer valido, non scaduto e con TTL massimo', () => {
    const expiry = Math.floor(Date.now() / 1000) + 120
    const token = `${expiry}.${'a'.repeat(43)}`
    process.env[GEMINI_SINGLE_TOKEN_ENV] = token
    const authorized = new Request('https://dev.utraya.com/api/internal/gemini-single-probe-20261002-1400', {
      headers: { authorization: `Bearer ${token}` },
    })
    const missing = new Request('https://dev.utraya.com/api/internal/gemini-single-probe-20261002-1400')
    expect(isSingleProbeAuthorized(authorized)).toBe(true)
    expect(isSingleProbeAuthorized(missing)).toBe(false)

    process.env[GEMINI_SINGLE_TOKEN_ENV] = `${Math.floor(Date.now() / 1000) + 901}.${'b'.repeat(43)}`
    expect(isSingleProbeAuthorized(authorized)).toBe(false)
  })

  it('consente un solo claim runtime', () => {
    expect(claimSingleProbeInThisRuntime()).toBe(true)
    expect(claimSingleProbeInThisRuntime()).toBe(false)
  })
})

describe('response capture and sanitization', () => {
  it('cattura status, header e body in memoria', () => {
    const captured = parseCurlCapture(wireResponse('{"ok":true,"ready":true}', 201))
    const headers = captured.headers as Record<string, string>
    expect(captured).toMatchObject({ captured: true, status: 201, truncated: false })
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-request-id']).toBe('offline-test')
    expect(captured.bodyText).toContain('"ready":true')
  })

  it('mantiene status/header e tronca il body oltre il cap in byte UTF-8', () => {
    const body = 'è'.repeat(CAPTURE_BODY_CAP_BYTES)
    const captured = parseCurlCapture(wireResponse(body, 202, 'x-probe-case: large'))
    const headers = captured.headers as Record<string, string>
    expect(captured.captured).toBe(true)
    expect(captured.status).toBe(202)
    expect(headers['x-probe-case']).toBe('large')
    expect(captured.truncated).toBe(true)
    expect(captured.bodyBytes).toBeLessThanOrEqual(CAPTURE_BODY_CAP_BYTES)
  })

  it('non pubblica summary né altri campi non allowlistati nel report', () => {
    const captured = parseCurlCapture(wireResponse(
      '{"ok":true,"model":"gemini-3.5-flash-lite","full_summary":"testo riservato","apiKey":"non-esporre"}'
    ))
    const sanitized = summarizeBody(captured)
    expect(sanitized).toEqual({ ok: true, model: 'gemini-3.5-flash-lite' })
    expect(JSON.stringify(sanitized)).not.toContain('testo riservato')
    expect(JSON.stringify(sanitized)).not.toContain('non-esporre')
  })

  it('non considera catturata una risposta senza marker di status', () => {
    expect(parseCurlCapture('nessuna risposta HTTP').captured).toBe(false)
  })
})
