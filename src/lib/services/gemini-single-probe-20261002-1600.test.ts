/* Commento didattico:
 * Scopo: verifica offline i limiti e l'identità della prova Gemini T8 e del trasporto mocked.
 * Moduli richiamati: service mono-video, controller Node fetch e Vitest.
 * Flusso: controlla selezione server-side, idempotenza, singola chiamata, limiti provider, capture e sanitizzazione.
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
  sanitizeProviderErrorCode,
  selectEligibleSingleVideo,
} from './gemini-single-probe-20261002-1600'
import {
  captureResponse,
  CAPTURE_BODY_CAP_BYTES,
  identifyTemporaryEnvironment,
  loadVercelApiToken,
  parseApprovedVercelTokenLine,
  runLive,
  runDryRun,
  summarizeRunnerBody,
  TOKEN_ENV,
} from '../../../scripts/gemini-single-probe-controller-20261002-1600.mjs'

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

describe('single probe identity and eligibility', () => {
  it('usa key, env, job type e modello nuovi del task T8', () => {
    expect(GEMINI_SINGLE_PROBE_RUN_ID).toBe('2026-10-02-1600-direct-fetch')
    expect(GEMINI_SINGLE_PROBE_DEDUPE_KEY).toBe('temporary-gemini-video-analysis:2026-10-02-1600-direct-fetch')
    expect(GEMINI_SINGLE_TOKEN_ENV).toBe('GEMINI_SINGLE_TOKEN_20261002_1600')
    expect(GEMINI_SINGLE_PROBE_JOB_TYPE).toBe('gemini_dev_single_probe')
    expect(GEMINI_SINGLE_PROBE_MODEL).toBe('gemini-3.5-flash-lite')
  })

  it('seleziona un solo video disponibile non già analizzato/localizzato', () => {
    expect(selectEligibleSingleVideo(videos, new Set(['video-1']), new Set(['video-2']))).toBeNull()
    expect(selectEligibleSingleVideo(videos, new Set(), new Set())?.id).toBe('video-1')
  })

  it('rifiuta URL non HTTPS, host non YouTube o ID discordanti', () => {
    expect(selectEligibleSingleVideo([{ ...videos[0], video_url: 'http://youtube.com/watch?v=youtube-id-0001' }], new Set(), new Set())).toBeNull()
    expect(selectEligibleSingleVideo([{ ...videos[0], video_url: 'https://example.com/watch?v=youtube-id-0001' }], new Set(), new Set())).toBeNull()
    expect(selectEligibleSingleVideo([{ ...videos[0], video_url: 'https://youtu.be/youtube-id-0002' }], new Set(), new Set())).toBeNull()
  })
})

describe('one provider request', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('invia un solo POST 3.5 con store:false e massimo 400 token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Sintesi riformulata.' }] }],
      usage: { total_input_tokens: 20, total_output_tokens: 10, total_tokens: 30 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestSingleVideoSummary({ apiKey: 'server-only-test-key', video: videos[0] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body)) as { model: string; store: boolean; generation_config: { max_output_tokens: number } }
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(options.method).toBe('POST')
    expect(options.redirect).toBe('error')
    expect(new Headers(options.headers).get('x-goog-api-key')).toBe('server-only-test-key')
    expect(body.model).toBe('gemini-3.5-flash-lite')
    expect(body.store).toBe(false)
    expect(body.generation_config.max_output_tokens).toBe(400)
    expect(JSON.stringify(result)).not.toContain('server-only-test-key')
  })

  it('non ritenta un errore di rete', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestSingleVideoSummary({ apiKey: 'server-only-test-key', video: videos[0] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, failure: 'provider_network_or_timeout' })
  })

  it('consente solo providerErrorCode numerico o maiuscolo sicuro massimo 64 caratteri', () => {
    expect(sanitizeProviderErrorCode('RESOURCE_EXHAUSTED')).toBe('RESOURCE_EXHAUSTED')
    expect(sanitizeProviderErrorCode(429)).toBe('429')
    expect(sanitizeProviderErrorCode('provider message: private detail')).toBeNull()
    expect(sanitizeProviderErrorCode('A'.repeat(65))).toBeNull()
    expect(sanitizeProviderErrorCode(Number.MAX_VALUE)).toBeNull()
  })

  it('non inoltra messaggi o body provider quando il codice errore non è sicuro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { status: 'PRIVATE provider detail', message: 'PRIVATE provider message' },
    }), { status: 429 })))
    const result = await requestSingleVideoSummary({ apiKey: 'server-only-test-key', video: videos[0] })
    expect(result).toMatchObject({ ok: false, httpStatus: 429, providerErrorCode: null })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(JSON.stringify(result)).not.toContain('server-only-test-key')
  })
})

describe('temporary route authorization and runtime latch', () => {
  afterEach(() => {
    delete process.env[GEMINI_SINGLE_TOKEN_ENV]
    resetSingleProbeRuntimeClaimForTests()
  })

  it('accetta solo il bearer valido e non scaduto entro 15 minuti', () => {
    const expiry = Math.floor(Date.now() / 1000) + 120
    const token = `${expiry}.${'a'.repeat(43)}`
    process.env[GEMINI_SINGLE_TOKEN_ENV] = token
    const authorized = new Request('https://dev.utraya.com/api/internal/gemini-single-probe-20261002-1600', {
      headers: { authorization: `Bearer ${token}` },
    })
    const missing = new Request('https://dev.utraya.com/api/internal/gemini-single-probe-20261002-1600')
    expect(isSingleProbeAuthorized(authorized)).toBe(true)
    expect(isSingleProbeAuthorized(missing)).toBe(false)

    process.env[GEMINI_SINGLE_TOKEN_ENV] = `${Math.floor(Date.now() / 1000) + 901}.${'b'.repeat(43)}`
    expect(isSingleProbeAuthorized(authorized)).toBe(false)
  })

  it('permette un solo claim in questo runtime', () => {
    expect(claimSingleProbeInThisRuntime()).toBe(true)
    expect(claimSingleProbeInThisRuntime()).toBe(false)
  })
})

describe('Node fetch mocked capture', () => {
  it('cattura status/header/body, risposta lenta e limita il body a 1 MB senza stamparlo', async () => {
    const result = await runDryRun()
    expect(result.ok).toBe(true)
    expect(result.checks).toEqual({
      statusHeaderBodyCaptured: true,
      slowResponseCaptured: true,
      oneMegabyteCap: true,
      bodyNotIncludedInEvidence: true,
    })
    expect(result.evidence.find((entry) => entry.case === 'large')?.bodyBytes).toBe(CAPTURE_BODY_CAP_BYTES)
    expect(JSON.stringify(result)).not.toContain('must-not-print')
    expect(JSON.stringify(result)).not.toContain('bodyText')
  })
})

describe('approved Vercel token source and sanitized controller reports', () => {
  it('loads only VERCEL_TOKEN_DEV and parses only its exact assignment', async () => {
    expect(parseApprovedVercelTokenLine('OTHER_TOKEN=ignore-me')).toEqual({ matched: false, token: null })
    expect(parseApprovedVercelTokenLine(' VERCEL_TOKEN_DEV = "mock-vercel-token" ')).toEqual({ matched: true, token: 'mock-vercel-token' })
    expect(parseApprovedVercelTokenLine("VERCEL_TOKEN_DEV='bad token'")).toEqual({ matched: true, token: null })
    await expect(loadVercelApiToken({ environment: { VERCEL_TOKEN_DEV: 'mock-vercel-token' } })).resolves.toBe('mock-vercel-token')
    await expect(loadVercelApiToken({ environment: { VERCEL_TOKEN: 'unapproved-name' }, filePath: 'C:\\missing-t8-dev.env' })).resolves.toBeNull()
  })

  it('filtra l’inventario env in RAM e il report non include summary/header/valori', async () => {
    const selected = identifyTemporaryEnvironment({
      envs: [
        { id: 'icfg_t8probe', key: TOKEN_ENV, type: 'sensitive', target: ['production'], value: 'private-token-value' },
        { id: 'icfg_other', key: 'PUBLIC_CONFIG', type: 'plain', target: ['production'], value: 'private-config-value' },
        { id: 'icfg_preview', key: TOKEN_ENV, type: 'sensitive', target: ['preview'], value: 'wrong-target-value' },
      ],
      pagination: { next: null },
      hiddenProductionEnvCount: 0,
    })
    expect(selected).toEqual({ complete: true, envId: 'icfg_t8probe', matchingCount: 1 })
    expect(JSON.stringify(selected)).not.toContain('private-token-value')
    expect(JSON.stringify(selected)).not.toContain('private-config-value')

    const capture = await captureResponse(new Response(JSON.stringify({
      ok: true,
      mode: 'readback',
      model: 'gemini-3.5-flash-lite',
      providerErrorCode: 'RESOURCE_EXHAUSTED',
      usage: { inputTokens: 5, outputTokens: 8, totalTokens: 13 },
      full_summary: 'DO-NOT-REPORT-SUMMARY',
      short_summary: 'DO-NOT-REPORT-SHORT-SUMMARY',
      authorization: 'Bearer DO-NOT-REPORT-AUTH',
      vercelToken: 'DO-NOT-REPORT-VERCEL-TOKEN',
      environmentValue: 'DO-NOT-REPORT-ENV-VALUE',
    }), { status: 200, headers: { 'content-type': 'application/json', authorization: 'Bearer response-header-secret' } }))
    const sanitized = summarizeRunnerBody(capture)
    expect(sanitized).toMatchObject({ ok: true, mode: 'readback', model: 'gemini-3.5-flash-lite', providerErrorCode: 'RESOURCE_EXHAUSTED' })
    expect(capture.headers).not.toHaveProperty('authorization')
    const serialized = JSON.stringify({ sanitized, headers: capture.headers })
    for (const marker of ['DO-NOT-REPORT', 'response-header-secret', 'private-token-value', 'private-config-value']) {
      expect(serialized).not.toContain(marker)
    }
  })

  it('scarta codici errore provider non sicuri o oltre 64 caratteri', async () => {
    const capture = await captureResponse(new Response(JSON.stringify({
      ok: false,
      providerErrorCode: 'SECRET ERROR: include provider message',
      full_summary: 'not permitted',
    }), { status: 502 }))
    const sanitized = summarizeRunnerBody(capture)
    expect(sanitized).not.toHaveProperty('providerErrorCode')
    expect(JSON.stringify(sanitized)).not.toContain('SECRET ERROR')
  })
})

function makeMockVercelRequest({ createWithoutId = false, collectionHasMatch = true } = {}) {
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
  let targetedReadCount = 0
  let deleted = false
  let temporaryTokenValue: unknown = null
  const envId = 'icfg_t8probe'
  const deployment = {
    projectId: 'prj_WvMmCKqDtOFsATZW2MkCg8PHd1Ht',
    readyState: 'READY',
    target: 'production',
    meta: { githubCommitRef: 'dev', githubCommitSha: '662d3cc958fdf28a6df5ef7ffbf0d8253b64d78b' },
  }
  const request = vi.fn(async (path: string, options: { method?: string; body?: Record<string, unknown> } = {}) => {
    const method = options.method ?? 'GET'
    calls.push({ path, method, body: options.body })
    if (method === 'POST' && path === '/v10/projects/prj_WvMmCKqDtOFsATZW2MkCg8PHd1Ht/env') {
      temporaryTokenValue = options.body?.value
      return {
        capture: { status: 201 },
        body: { created: createWithoutId
          ? { key: TOKEN_ENV, type: 'sensitive', target: ['production'], value: temporaryTokenValue }
          : { id: envId, key: TOKEN_ENV, type: 'sensitive', target: ['production'], value: temporaryTokenValue } },
      }
    }
    if (method === 'GET' && path === '/v10/projects/prj_WvMmCKqDtOFsATZW2MkCg8PHd1Ht/env?decrypt=false') {
      return {
        capture: { status: 200 },
        body: {
          envs: collectionHasMatch
            ? [
                { id: envId, key: TOKEN_ENV, type: 'sensitive', target: ['production'], value: temporaryTokenValue },
                { id: 'icfg_other', key: 'PUBLIC_CONFIG', type: 'plain', target: ['production'], value: 'other-private-config' },
              ]
            : [{ id: 'icfg_other', key: 'PUBLIC_CONFIG', type: 'plain', target: ['production'], value: 'other-private-config' }],
          pagination: { next: null },
          hiddenProductionEnvCount: 0,
        },
      }
    }
    if (method === 'GET' && path === `/v1/projects/prj_WvMmCKqDtOFsATZW2MkCg8PHd1Ht/env/${envId}`) {
      targetedReadCount += 1
      return deleted || targetedReadCount > 1
        ? { capture: { status: 404 }, body: null }
        : { capture: { status: 200 }, body: { key: TOKEN_ENV, type: 'sensitive', target: ['production'], value: temporaryTokenValue } }
    }
    if (method === 'DELETE' && path === `/v9/projects/prj_WvMmCKqDtOFsATZW2MkCg8PHd1Ht/env/${envId}`) {
      deleted = true
      return { capture: { status: 204 }, body: null }
    }
    if (method === 'GET' && path === '/v13/deployments/dpl_initial') return { capture: { status: 200 }, body: deployment }
    if (method === 'POST' && path === '/v13/deployments') return { capture: { status: 200 }, body: { id: 'dpl_redeployed' } }
    if (method === 'GET' && path === '/v13/deployments/dpl_redeployed') return { capture: { status: 200 }, body: { ...deployment, id: 'dpl_redeployed' } }
    throw new Error(`Unexpected mocked Vercel request: ${method} ${path}`)
  })
  return { request, calls, get temporaryTokenValue() { return temporaryTokenValue } }
}

describe('live orchestration cleanup in mocked conditions only', () => {
  const vercelToken = 'mock-vercel-token-not-for-report'

  it('ripulisce l’env e verifica 404 se readiness fallisce, senza POST applicativa', async () => {
    const api = makeMockVercelRequest()
    const runner = vi.fn().mockResolvedValue({ status: 409, payload: { ok: false, mode: 'ready', ready: false, failure: 'eligible_video_unavailable' } })
    const report = await runLive('dpl_initial', true, { vercelToken, vercelRequest: api.request, invokeRunner: runner, sleep: async () => undefined })

    expect(report.stage).toBe('readiness')
    expect(report.cleanup).toMatchObject({ state: 'verified_absent', deleteStatus: 204, verifyStatus: 404, verifiedAbsent: true })
    expect(runner.mock.calls.map(([method]) => method)).toEqual(['GET'])
    expect(api.calls.some((call) => call.method === 'DELETE' && call.path.startsWith('/v9/projects/'))).toBe(true)
    expect(JSON.stringify(report)).not.toContain(vercelToken)
    expect(JSON.stringify(report)).not.toContain(String(api.temporaryTokenValue))
  })

  it('ripulisce e verifica 404 dopo POST app ambigua, senza ritentare la POST', async () => {
    const api = makeMockVercelRequest()
    const runner = vi.fn()
      .mockResolvedValueOnce({ status: 200, payload: { ok: true, mode: 'ready', ready: true, model: 'gemini-3.5-flash-lite', eligibleVideoAvailable: true } })
      .mockResolvedValueOnce({ status: null, payload: null })
      .mockResolvedValueOnce({ status: 409, payload: { ok: false, mode: 'readback', failure: 'readback_unavailable' } })
    const report = await runLive('dpl_initial', true, { vercelToken, vercelRequest: api.request, invokeRunner: runner, sleep: async () => undefined })

    expect(report.postAttempted).toBe(true)
    expect(report.providerProbeVerified).toBe(false)
    expect(report.cleanup).toMatchObject({ state: 'verified_absent', deleteStatus: 204, verifyStatus: 404, verifiedAbsent: true })
    expect(runner.mock.calls.map(([method]) => method)).toEqual(['GET', 'POST', 'GET'])
    expect(runner.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1)
    expect(JSON.stringify(report)).not.toContain(vercelToken)
    expect(JSON.stringify(report)).not.toContain(String(api.temporaryTokenValue))
  })

  it('usa la GET collection decrypt=false se create 2xx omette envId e non serializza values', async () => {
    const api = makeMockVercelRequest({ createWithoutId: true })
    const runner = vi.fn().mockResolvedValue({ status: 409, payload: { ok: false, mode: 'ready', ready: false, failure: 'eligible_video_unavailable' } })
    const report = await runLive('dpl_initial', true, { vercelToken, vercelRequest: api.request, invokeRunner: runner, sleep: async () => undefined })

    expect(api.calls.some((call) => call.path === '/v10/projects/prj_WvMmCKqDtOFsATZW2MkCg8PHd1Ht/env?decrypt=false')).toBe(true)
    expect(report.cleanup?.verifiedAbsent).toBe(true)
    expect(runner.mock.calls.map(([method]) => method)).toEqual(['GET'])
    expect(JSON.stringify(report)).not.toContain('other-private-config')
    expect(JSON.stringify(report)).not.toContain(String(api.temporaryTokenValue))
  })

  it('si ferma con cleanup indeterminato quando la GET collection non trova l’id', async () => {
    const api = makeMockVercelRequest({ createWithoutId: true, collectionHasMatch: false })
    const runner = vi.fn()
    const report = await runLive('dpl_initial', true, { vercelToken, vercelRequest: api.request, invokeRunner: runner, sleep: async () => undefined })

    expect(report.cleanup).toMatchObject({ state: 'indeterminate', verifiedAbsent: false })
    expect(report.failure).toBe('environment_id_unavailable')
    expect(runner).not.toHaveBeenCalled()
    expect(api.calls.filter((call) => call.path.includes('/env?decrypt=false'))).toHaveLength(1)
    expect(api.calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(JSON.stringify(report)).not.toContain('other-private-config')
  })
})
