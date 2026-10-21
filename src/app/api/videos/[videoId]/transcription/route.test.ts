/* Commento didattico:
 * Scopo del file: verifica la route di richiesta/stato trascrizione (auth, follower, chiave, 202+jobId, after con Promise).
 * Moduli richiamati: `vitest`, route, servizi mockati al confine (nessun database).
 * Flusso: simula utente e servizi, poi controlla status HTTP, envelope e che `after` riceva un callback che restituisce la Promise del worker.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/utils/errors'

const { getCurrentUserMock, requestMock, loadVideoMock, viewMock, runJobMock, afterMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  requestMock: vi.fn(),
  loadVideoMock: vi.fn(),
  viewMock: vi.fn(),
  runJobMock: vi.fn(),
  afterMock: vi.fn(),
}))

vi.mock('@/lib/auth/getCurrentUser', () => ({ getCurrentUser: getCurrentUserMock }))
vi.mock('@/lib/services/transcription-requests', () => ({
  requestTranscriptionForUser: requestMock,
  loadFollowedVideo: loadVideoMock,
  getTranscriptionViewModel: viewMock,
  runTranscriptionJobNow: runJobMock,
}))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: afterMock }))

import { GET, POST, maxDuration } from './route'

const VIDEO = '5f1a3b1e-0000-4000-8000-000000000001'
const ctx = { params: Promise.resolve({ videoId: VIDEO }) }

function post(body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(`https://app.test/api/videos/${VIDEO}/transcription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.test', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/videos/[videoId]/transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUserMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
  })

  it('espone una durata massima compatibile con il piano Hobby (300 s)', () => {
    expect(maxDuration).toBe(300)
  })

  it('rifiuta origine diversa senza invocare il service', async () => {
    expect((await POST(post({}, { origin: 'https://evil.test' }), ctx)).status).toBe(403)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('rifiuta content-type errato senza invocare il service', async () => {
    expect((await POST(post({}, { 'content-type': 'text/plain' }), ctx)).status).toBe(415)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('rifiuta un payload con campo extra senza invocare il service', async () => {
    expect((await POST(post({ extra: true }), ctx)).status).toBe(400)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('rifiuta un videoId non UUID senza invocare il service', async () => {
    expect((await POST(post({}), { params: Promise.resolve({ videoId: 'non-uuid' }) })).status).toBe(400)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('senza sessione risponde 401', async () => {
    getCurrentUserMock.mockResolvedValue(null)
    const response = await POST(post(), ctx)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } })
  })

  it('non follower: 403 FORBIDDEN senza avviare il worker', async () => {
    requestMock.mockRejectedValue(new AppError('Canale non seguito', 'forbidden', 403))
    const response = await POST(post(), ctx)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('senza chiave Gemini: 403 con codice stabile e messaggio sanificato', async () => {
    requestMock.mockRejectedValue(new AppError('Serve una chiave Gemini personale valida', 'forbidden', 403, { code: 'GEMINI_KEY_REQUIRED', cause: 'dettaglio interno' }))
    const response = await POST(post(), ctx)
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error.code).toBe('GEMINI_KEY_REQUIRED')
    expect(JSON.stringify(body)).not.toContain('dettaglio interno')
  })

  it('errori inattesi diventano 500 generici', async () => {
    requestMock.mockRejectedValue(new Error('password=segreta'))
    const response = await POST(post(), ctx)
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('segreta')
  })

  it('risponde 202 con jobId e passa a after() il callback che restituisce la Promise del worker', async () => {
    requestMock.mockResolvedValue({ jobId: 'job-1', transcriptionStatus: 'pending', shouldRun: true, reused: false })
    const workerPromise = Promise.resolve({ outcome: 'complete', partsSaved: 3 })
    runJobMock.mockReturnValue(workerPromise)

    const response = await POST(post(), ctx)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ ok: true, data: { jobId: 'job-1', status: 'pending', reused: false } })
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', videoId: VIDEO }))
    expect(afterMock).toHaveBeenCalledTimes(1)
    const callback = afterMock.mock.calls[0][0] as () => unknown
    expect(callback()).toBe(workerPromise)
    expect(runJobMock).toHaveBeenCalledWith('job-1')
  })

  it('trascrizione riusata: 200 senza job né worker', async () => {
    requestMock.mockResolvedValue({ jobId: null, transcriptionStatus: 'complete', shouldRun: false, reused: true })
    const response = await POST(post(), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { jobId: null, status: 'complete', reused: true } })
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('job già in corso con lease valida: 202 senza un secondo worker', async () => {
    requestMock.mockResolvedValue({ jobId: 'job-9', transcriptionStatus: 'running', shouldRun: false, reused: false })
    const response = await POST(post(), ctx)
    expect(response.status).toBe(202)
    expect(afterMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/videos/[videoId]/transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUserMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
  })

  it('richiede sessione e video seguito', async () => {
    getCurrentUserMock.mockResolvedValue(null)
    expect((await GET(new Request('https://app.test/x'), ctx)).status).toBe(401)

    getCurrentUserMock.mockResolvedValue({ user: { id: 'user-1' }, supabase: {} })
    loadVideoMock.mockRejectedValue(new AppError('Canale non seguito', 'forbidden', 403))
    expect((await GET(new Request('https://app.test/x'), ctx)).status).toBe(403)
  })

  it('restituisce il view model', async () => {
    loadVideoMock.mockResolvedValue({ id: VIDEO })
    viewMock.mockResolvedValue({ videoId: VIDEO, state: 'running' })
    const response = await GET(new Request('https://app.test/x'), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { state: 'running' } })
  })
})
