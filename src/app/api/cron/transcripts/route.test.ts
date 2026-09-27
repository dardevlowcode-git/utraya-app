/* Commento didattico:
 * Scopo del file: verifica i confini HTTP del cron transcript e del fixture mode DEV.
 * Moduli richiamati: route handler con impostazioni, admin client e service simulati.
 * Flusso: testa auth, validazione, allowlist ambiente, filtro fixture e output sintetico.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/transcripts/route'
import { getTranscriptSettings } from '@/lib/services/cron-settings'
import {
  processPendingTranscripts,
  runTranscriptFixture,
  TranscriptFixtureCleanupError,
} from '@/lib/services/video-transcripts'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/services/cron-settings', () => ({
  getTranscriptSettings: vi.fn(),
}))

vi.mock('@/lib/security/http', () => ({
  getRequestId: vi.fn(() => 'transcript-route-test'),
}))

vi.mock('@/lib/services/video-transcripts', () => ({
  processPendingTranscripts: vi.fn(),
  runTranscriptFixture: vi.fn(),
  TranscriptFixtureCleanupError: class TranscriptFixtureCleanupError extends Error {
    constructor(message?: string) {
      super(message)
    }
  },
}))

const cronSecret = 'test-only-cron-secret'
const fixtureVideoId = 'Abcdefghijk'

function request(query = '', authorization = `Bearer ${cronSecret}`): Request {
  return new Request(`https://app.test/api/cron/transcripts${query}`, {
    headers: authorization ? { authorization } : {},
  })
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('GET /api/cron/transcripts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', cronSecret)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dev.utraya.com')
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'dev')
    vi.stubEnv('TRANSCRIPT_E2E_VIDEO_ID', fixtureVideoId)
    vi.mocked(createAdminClient).mockReturnValue({} as never)
    vi.mocked(getTranscriptSettings).mockResolvedValue({ enabled: true, batch_limit: 10 })
    vi.mocked(processPendingTranscripts).mockResolvedValue({
      success: true,
      checked: 2,
      fetched: 2,
      missing: 0,
      failed: 0,
      skipped: 0,
    })
    vi.mocked(runTranscriptFixture).mockResolvedValue({
      success: true,
      checked: 1,
      fetched: 1,
      missing: 0,
      failed: 0,
      skipped: 0,
      cleanup: 'completed',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('mantiene il normale batch cron senza fixture', async () => {
    const response = await GET(request('?limit=4'))

    expect(response.status).toBe(200)
    expect(processPendingTranscripts).toHaveBeenCalledWith(4, expect.any(Function), {
      requestId: 'transcript-route-test',
    })
    expect(runTranscriptFixture).not.toHaveBeenCalled()
  })

  it('limita fixture mode alla riga configurata e restituisce solo conteggi', async () => {
    const response = await GET(request(`?fixture_video_id=${fixtureVideoId}&limit=1`))
    const body = await responseBody(response)

    expect(response.status).toBe(200)
    expect(runTranscriptFixture).toHaveBeenCalledWith(fixtureVideoId, expect.any(Function), {
      requestId: 'transcript-route-test',
    })
    expect(processPendingTranscripts).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain(fixtureVideoId)
    expect(JSON.stringify(body)).not.toContain('transcript_text')
    expect(JSON.stringify(body)).not.toContain('error_details')
  })

  it.each([
    ['URL non DEV', 'NEXT_PUBLIC_SITE_URL', 'https://preview.utraya.com'],
    ['ref non dev', 'VERCEL_GIT_COMMIT_REF', 'preprod'],
    ['ID fixture differente', 'TRANSCRIPT_E2E_VIDEO_ID', 'Zbcdefghijk'],
  ])('rifiuta la fixture con %s', async (_label, variable, value) => {
    vi.stubEnv(variable, value)

    const response = await GET(request(`?fixture_video_id=${fixtureVideoId}&limit=1`))

    expect(response.status).toBe(403)
    expect(runTranscriptFixture).not.toHaveBeenCalled()
    expect(getTranscriptSettings).not.toHaveBeenCalled()
  })

  it.each([
    ['ID malformato', '?fixture_video_id=short&limit=1'],
    ['limit diverso da uno', `?fixture_video_id=${fixtureVideoId}&limit=2`],
    ['origine arbitraria', `?fixture_video_id=${fixtureVideoId}&limit=1&base_url=https://example.com`],
  ])('rifiuta input fixture non valido: %s', async (_label, query) => {
    const response = await GET(request(query))

    expect(response.status).toBe(400)
    expect(runTranscriptFixture).not.toHaveBeenCalled()
  })

  it('segnala il cleanup fallito senza esporre il dettaglio interno', async () => {
    const privateError = new TranscriptFixtureCleanupError()
    privateError.message = 'private cleanup payload'
    vi.mocked(runTranscriptFixture).mockRejectedValue(privateError)

    const response = await GET(request(`?fixture_video_id=${fixtureVideoId}&limit=1`))
    const body = await responseBody(response)

    expect(response.status).toBe(500)
    expect(response.headers.get('X-Transcript-Fixture-Cleanup')).toBe('failed')
    expect(body).toMatchObject({ ok: false, error: { code: 'FIXTURE_CLEANUP_FAILED' } })
    expect(JSON.stringify(body)).not.toContain('private cleanup payload')
  })

  it('mantiene il cron protetto dal Bearer secret', async () => {
    const response = await GET(request(`?fixture_video_id=${fixtureVideoId}&limit=1`, 'Bearer wrong'))

    expect(response.status).toBe(401)
    expect(runTranscriptFixture).not.toHaveBeenCalled()
  })
})
