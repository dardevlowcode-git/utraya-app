/* Commento didattico:
 * Scopo del file: verifica il confine HTTP admin del rilancio delle parti mancanti.
 * Moduli richiamati: route admin, auth admin, service admin-transcriptions, job chain e vitest.
 * Flusso: prova autorizzazione, validazioni, esiti del servizio e avvio del job in `after()` con Promise restituita.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessionMock, relaunchMock, chainMock, afterMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(), relaunchMock: vi.fn(), chainMock: vi.fn(), afterMock: vi.fn(),
}))

vi.mock('next/server', () => ({ after: afterMock }))
vi.mock('@/lib/auth/admin', () => ({ getAdminSession: sessionMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/services/admin-transcriptions', () => ({ relaunchMissingParts: relaunchMock }))
vi.mock('@/lib/services/transcription-auto', () => ({ runTranscriptionJobAndChain: chainMock }))

import { POST } from '@/app/api/admin/transcriptions/[transcriptionId]/relaunch/route'

const id = '65200000-0000-4000-8000-000000000001'
const headers = { origin: 'http://localhost', 'content-type': 'application/json' }

function post(body: unknown, requestHeaders: Record<string, string> = headers, transcriptionId = id) {
  return POST(
    new Request(`http://localhost/api/admin/transcriptions/${transcriptionId}/relaunch`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) }),
    { params: Promise.resolve({ transcriptionId }) }
  )
}

describe('route admin rilancio parti mancanti', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionMock.mockResolvedValue({ username: 'admin' })
    chainMock.mockResolvedValue({ outcome: 'complete', partsSaved: 1 })
    relaunchMock.mockResolvedValue({ status: 'relaunched', jobId: 'job-1', partsReset: 2, credentialMode: 'requester' })
  })

  it('nega senza sessione admin (401) senza toccare il database', async () => {
    sessionMock.mockResolvedValue(null)

    expect((await post({})).status).toBe(401)
    expect(relaunchMock).not.toHaveBeenCalled()
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('rifiuta origine assente o diversa (403)', async () => {
    expect((await post({}, { 'content-type': 'application/json' })).status).toBe(403)
    expect((await post({}, { origin: 'http://evil.test', 'content-type': 'application/json' })).status).toBe(403)
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['campo extra', { partPosition: 1, extra: true }],
    ['parte negativa', { partPosition: -1 }],
    ['parte non intera', { partPosition: 1.5 }],
    ['parte come stringa', { partPosition: '1' }],
  ])('rifiuta %s con 400', async (_name, body) => {
    expect((await post(body)).status).toBe(400)
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('rifiuta un id non UUID con 400', async () => {
    expect((await post({}, headers, 'non-uuid')).status).toBe(400)
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('rilancia tutte le parti mancanti con username admin e avvia il job con after()', async () => {
    const response = await post({})

    expect(response.status).toBe(202)
    expect(relaunchMock).toHaveBeenCalledWith({}, { transcriptionId: id, partPosition: null, adminUsername: 'admin' })
    expect(await response.json()).toMatchObject({ ok: true, data: { jobId: 'job-1', partsReset: 2, credentialMode: 'requester' } })
    expect(afterMock).toHaveBeenCalledTimes(1)
    const task = afterMock.mock.calls[0][0] as () => Promise<unknown>
    await expect(task()).resolves.toEqual({ outcome: 'complete', partsSaved: 1 })
    expect(chainMock).toHaveBeenCalledWith('job-1')
  })

  it('rilancia una singola parte', async () => {
    await post({ partPosition: 3 })

    expect(relaunchMock).toHaveBeenCalledWith({}, { transcriptionId: id, partPosition: 3, adminUsername: 'admin' })
  })

  it.each([
    ['not_found', 404],
    ['no_missing', 409],
    ['busy', 409],
  ])('esito %s: %i e nessun job avviato', async (status, httpStatus) => {
    relaunchMock.mockResolvedValue({ status })

    expect((await post({})).status).toBe(httpStatus)
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('errore interno: 500 con messaggio stabile e senza dettagli', async () => {
    relaunchMock.mockRejectedValue(new Error('postgres://secret'))

    const response = await post({})

    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })
})
