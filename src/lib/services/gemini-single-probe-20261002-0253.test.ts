/* Commento didattico:
 * Scopo del file: verifica offline la mono-prova Gemini (selezione, contratto singola chiamata, capture risposta).
 * Moduli richiamati: service temporaneo single-probe con fetch simulato da Vitest.
 * Flusso: esclude video già trattati, controlla modello/store/limite/assenza retry e capture status-header-body anche lenta o troncata.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureProbedResponse,
  claimSingleProbeInThisRuntime,
  extractSingleSummary,
  GEMINI_SINGLE_PROBE_DEDUPE_KEY,
  GEMINI_SINGLE_PROBE_JOB_TYPE,
  GEMINI_SINGLE_PROBE_MODEL,
  GEMINI_SINGLE_PROBE_RUN_ID,
  isSingleProbeAuthorized,
  makeSingleShortSummary,
  requestSingleVideoSummary,
  resetSingleProbeRuntimeClaimForTests,
  selectEligibleSingleVideo,
} from './gemini-single-probe-20261002-0253'

const videos = [
  { id: 'v1', youtube_video_id: 'youtube-id-0001', video_url: 'https://www.youtube.com/watch?v=youtube-id-0001', published_at: '2026-10-02T00:00:00Z', availability_status: 'available' as const, video_type: 'standard' as const },
  { id: 'v2', youtube_video_id: 'youtube-id-0002', video_url: 'https://www.youtube.com/watch?v=youtube-id-0002', published_at: '2026-10-01T00:00:00Z', availability_status: 'available' as const, video_type: 'standard' as const },
]

describe('single probe identity', () => {
  it('usa idempotency key e job_type nuovi della run 2026-10-02-0253', () => {
    expect(GEMINI_SINGLE_PROBE_RUN_ID).toBe('2026-10-02-0253-singola-prova')
    expect(GEMINI_SINGLE_PROBE_DEDUPE_KEY).toBe('temporary-gemini-video-analysis:2026-10-02-0253-singola-prova')
    expect(GEMINI_SINGLE_PROBE_JOB_TYPE).toBe('gemini_dev_single_probe')
    expect(GEMINI_SINGLE_PROBE_DEDUPE_KEY).not.toContain('2026-09-28')
  })
})

describe('selectEligibleSingleVideo', () => {
  it('restituisce al massimo UN video senza analisi o localizzazione', () => {
    expect(selectEligibleSingleVideo(videos, new Set(['v1']), new Set(['v2']))).toBeNull()
    const selected = selectEligibleSingleVideo(videos, new Set(), new Set())
    expect(selected?.id).toBe('v1')
  })
})

describe('requestSingleVideoSummary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('invoca Gemini 3.5 UNA sola volta con store:false e max 400 token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: '[00:00] Introduzione.\n[01:10] Conclusione.' }] }],
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestSingleVideoSummary({ apiKey: 'probe-test-key', video: videos[0] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body)) as { model: string; store: boolean; generation_config: { max_output_tokens: number } }
    expect(body.model).toBe(GEMINI_SINGLE_PROBE_MODEL)
    expect(body.store).toBe(false)
    expect(body.generation_config.max_output_tokens).toBe(400)
    expect(result.ok).toBe(true)
  })

  it('non ritenta su errore di rete', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestSingleVideoSummary({ apiKey: 'probe-test-key', video: videos[0] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, failure: 'provider_network_or_timeout' })
  })
})

describe('extractSingleSummary / makeSingleShortSummary', () => {
  it('estrae solo i testi model_output e accorcia alla prima frase', () => {
    const summary = extractSingleSummary({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: '[00:00] Prima frase. Seconda frase.' }] }],
    })
    expect(summary).toContain('Prima frase')
    expect(makeSingleShortSummary(summary)).toBe('Prima frase.')
  })
})

describe('isSingleProbeAuthorized', () => {
  afterEach(() => {
    delete process.env.GEMINI_SINGLE_TOKEN_20261002_0253
  })

  it('accetta solo Bearer valido non scaduto', () => {
    const expiry = Math.floor(Date.now() / 1000) + 120
    const token = `${expiry}.${'a'.repeat(43)}`
    process.env.GEMINI_SINGLE_TOKEN_20261002_0253 = token
    const ok = new Request('https://dev.utraya.com/api/internal/gemini-single-probe-20261002-0253', {
      headers: { authorization: `Bearer ${token}` },
    })
    const ko = new Request('https://dev.utraya.com/api/internal/gemini-single-probe-20261002-0253')
    expect(isSingleProbeAuthorized(ok)).toBe(true)
    expect(isSingleProbeAuthorized(ko)).toBe(false)
  })
})

describe('claimSingleProbeInThisRuntime', () => {
  it('permette una sola esecuzione per runtime', () => {
    resetSingleProbeRuntimeClaimForTests()
    expect(claimSingleProbeInThisRuntime()).toBe(true)
    expect(claimSingleProbeInThisRuntime()).toBe(false)
    resetSingleProbeRuntimeClaimForTests()
  })
})

describe('captureProbedResponse', () => {
  it('cattura status, header e body in memoria', async () => {
    const captured = await captureProbedResponse(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json', 'x-probe': 'yes' } })
    )
    expect(captured.status).toBe(200)
    expect(captured.headers['content-type']).toContain('application/json')
    expect(captured.headers['x-probe']).toBe('yes')
    expect(captured.bodyText).toContain('"ok":true')
    expect(captured.truncated).toBe(false)
  })

  it('gestisce la risposta lenta senza perdere il body', async () => {
    const slow = new Response(
      new ReadableStream({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 300))
          controller.enqueue(new TextEncoder().encode('{"ok":true,"slow":true}'))
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
    const captured = await captureProbedResponse(slow)
    expect(captured.status).toBe(200)
    expect(captured.bodyText).toContain('"slow":true')
    expect(captured.truncated).toBe(false)
  })

  it('segnala il body troncato oltre il cap', async () => {
    const big = 'x'.repeat(1_000_000 + 100)
    const captured = await captureProbedResponse(new Response(big, { status: 200 }))
    expect(captured.truncated).toBe(true)
    expect(captured.bodyText.length).toBeLessThan(big.length)
  })
})
