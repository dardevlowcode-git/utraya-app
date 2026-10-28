import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClientMock, createSupabaseClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createSupabaseClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createSupabaseClientMock }))

import { runApiVerification } from '@/lib/verifier/api-verifier'

function apiResponse(status: number, data: unknown, requestId: string | null) {
  return new Response(JSON.stringify({ ok: true, data, requestId }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
  })
}

function responseForRequest(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  const requestId = new Headers(init?.headers).get('X-Request-Id')
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}

  if (url.pathname === '/api/v1/channels' && method === 'POST' && body.action === 'scan_now') {
    return apiResponse(202, { jobId: 'manual-job' }, requestId)
  }
  if (url.pathname === '/api/v1/jobs/manual-job') {
    return apiResponse(200, { status: 'completed' }, requestId)
  }
  if (url.pathname === '/api/v1/channels' && method === 'GET') {
    return apiResponse(200, [], requestId)
  }
  return apiResponse(200, {}, requestId)
}

describe('runApiVerification', () => {
  beforeEach(() => {
    createAdminClientMock.mockReturnValue({
      auth: { admin: { generateLink: vi.fn().mockResolvedValue({ data: { properties: { email_otp: 'fixture-otp' } }, error: null }) } },
    })
    createSupabaseClientMock.mockReturnValue({
      auth: { verifyOtp: vi.fn().mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null }) },
    })
    vi.stubEnv('API_E2E_USER_EMAIL', 'fixture@example.com')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-anon-key')
    vi.stubEnv('API_E2E_CHANNEL_ID', 'fixture-existing-channel')
    vi.stubEnv('API_E2E_CHANNEL_URL', '')
    vi.stubGlobal('fetch', vi.fn(responseForRequest))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('considera verde la scansione manuale quando l’API accoda il lavoro con 202', async () => {
    const report = await runApiVerification({ target: 'dev', mutations: true })

    expect(report.checks.find((check) => check.name === 'manual channel scan')).toMatchObject({
      expectedStatus: 202,
      actualStatus: 202,
      ok: true,
    })
    expect(report.checks.find((check) => check.name === 'manual scan job status')).toMatchObject({
      status: 'completed',
      ok: true,
    })
  })

  it('registra in rosso il job pending che attende una chiave YouTube', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const requestId = new Headers(init?.headers).get('X-Request-Id')
      if (url.pathname === '/api/v1/jobs/manual-job') {
        return Promise.resolve(apiResponse(200, { status: 'pending', waitingReason: 'youtube_key_missing' }, requestId))
      }
      return Promise.resolve(responseForRequest(input, init))
    })

    try {
      const verification = runApiVerification({ target: 'dev', mutations: true })
      await vi.advanceTimersByTimeAsync(30_000)
      const report = await verification

      expect(report.checks.find((check) => check.name === 'manual scan job status')).toMatchObject({
        status: 'youtube_key_missing',
        ok: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('non aggiunge né rimuove il canale fixture già seguito e registra un controllo rosso', async () => {
    vi.stubEnv('API_E2E_CHANNEL_ID', '')
    vi.stubEnv('API_E2E_CHANNEL_URL', 'https://www.youtube.com/@fixture-channel')
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const requestId = new Headers(init?.headers).get('X-Request-Id')

      if (url.pathname === '/api/v1/channels' && method === 'GET') {
        return Promise.resolve(apiResponse(200, [{
          id: 'fixture-followed-channel',
          youtubeChannelId: 'handle:fixture-channel',
          handle: 'fixture-channel',
          customUrl: 'https://www.youtube.com/@fixture-channel',
        }], requestId))
      }
      return Promise.resolve(responseForRequest(input, init))
    })

    const report = await runApiVerification({ target: 'dev', mutations: true })

    expect(fetchMock).not.toHaveBeenCalledWith('https://dev.utraya.com/api/v1/channels', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).not.toHaveBeenCalledWith('https://dev.utraya.com/api/v1/channels', expect.objectContaining({ method: 'DELETE' }))
    expect(report.checks.find((check) => check.name === 'fixture channel already followed')).toMatchObject({
      ok: false,
      message: expect.stringContaining('API_E2E_CHANNEL_URL'),
    })
  })

  it('rimuove il canale aggiunto anche quando la scansione resta pending', async () => {
    vi.useFakeTimers()
    vi.stubEnv('API_E2E_CHANNEL_ID', '')
    vi.stubEnv('API_E2E_CHANNEL_URL', 'https://www.youtube.com/@fixture-channel')
    let pendingPolls = 0
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const requestId = new Headers(init?.headers).get('X-Request-Id')
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}

      if (url.pathname === '/api/v1/channels' && method === 'POST' && body.action === 'add') {
        return Promise.resolve(apiResponse(202, {
          channelId: 'fixture-added-channel',
          scan: { jobId: 'fixture-scan-job' },
        }, requestId))
      }
      if (url.pathname === '/api/v1/jobs/fixture-scan-job') {
        pendingPolls += 1
        return Promise.resolve(apiResponse(200, { status: 'pending' }, requestId))
      }
      return Promise.resolve(responseForRequest(input, init))
    })

    try {
      const verification = runApiVerification({ target: 'dev', mutations: true })
      await vi.advanceTimersByTimeAsync(30_000)
      const report = await verification

      expect(pendingPolls).toBe(15)
      expect(fetchMock).toHaveBeenCalledWith('https://dev.utraya.com/api/v1/channels', expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ channelId: 'fixture-added-channel' }),
      }))
      expect(report.checks.find((check) => check.name === 'fixture scan job status')).toMatchObject({
        status: 'timeout',
        ok: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
