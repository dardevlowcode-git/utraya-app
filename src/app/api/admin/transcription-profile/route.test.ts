/* Commento didattico:
 * Scopo del file: verifica il confine HTTP admin del profilo di trascrizione.
 * Moduli richiamati: route admin, auth admin, service transcription-profile e vitest.
 * Flusso: prova autorizzazione, validazioni di payload e di dominio, salvataggio con username admin per l'audit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessionMock, getProfileMock, listModelsMock, updateMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(), getProfileMock: vi.fn(), listModelsMock: vi.fn(), updateMock: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({ getAdminSession: sessionMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/services/transcription-profile', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/transcription-profile')>('@/lib/services/transcription-profile')
  return { ...actual, getTranscriptionProfile: getProfileMock, listGeminiModels: listModelsMock, updateTranscriptionProfile: updateMock }
})

import { GET, PUT } from '@/app/api/admin/transcription-profile/route'

const profile = { model: 'gemini-3.1-flash-lite', thinkingLevel: 'minimal', inputPricePerMillion: 0.25, outputPricePerMillion: 1.5 }
const validBody = { model: 'gemini-2.5-flash', thinkingLevel: 'low', inputPricePerMillion: 0.3, outputPricePerMillion: 2.5 }

function put(body: unknown, headers: Record<string, string> = { origin: 'http://localhost', 'content-type': 'application/json' }) {
  return PUT(new Request('http://localhost/api/admin/transcription-profile', { method: 'PUT', headers, body: JSON.stringify(body) }))
}

describe('route admin profilo di trascrizione', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionMock.mockResolvedValue({ username: 'admin' })
    getProfileMock.mockResolvedValue(profile)
    listModelsMock.mockResolvedValue({ status: 'ok', models: ['gemini-2.5-flash'] })
    updateMock.mockResolvedValue({ ok: true, profile: { ...profile, model: 'gemini-2.5-flash' } })
  })

  it('nega GET e PUT senza sessione admin', async () => {
    sessionMock.mockResolvedValue(null)

    expect((await GET(new Request('http://localhost/api/admin/transcription-profile'))).status).toBe(401)
    expect((await put(validBody)).status).toBe(401)
    expect(listModelsMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rifiuta origine diversa o assente', async () => {
    expect((await put(validBody, { origin: 'http://evil.test', 'content-type': 'application/json' })).status).toBe(403)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('GET restituisce profilo ed elenco modelli', async () => {
    const response = await GET(new Request('http://localhost/api/admin/transcription-profile'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, data: { profile, models: { status: 'ok', models: ['gemini-2.5-flash'] } } })
  })

  it.each([
    ['prezzo negativo', { ...validBody, inputPricePerMillion: -1 }],
    ['troppi decimali', { ...validBody, outputPricePerMillion: 1.1234567 }],
    ['prezzo come stringa', { ...validBody, inputPricePerMillion: '1' }],
    ['livello sconosciuto', { ...validBody, thinkingLevel: 'extreme' }],
    ['nome modello non valido', { ...validBody, model: 'bad/model?x' }],
    ['campo extra', { ...validBody, apiKey: 'x' }],
  ])('rifiuta %s con 400 senza salvare', async (_name, body) => {
    const response = await put(body)

    expect(response.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('salva passando lo username admin per l’audit', async () => {
    const response = await put(validBody)

    expect(response.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({}, validBody, 'admin')
    expect(await response.json()).toMatchObject({ ok: true, data: { model: 'gemini-2.5-flash' } })
  })

  it.each([
    ['INVALID_LEVEL', 400],
    ['MODEL_NOT_LISTED', 400],
    ['MODELS_UNAVAILABLE', 409],
  ])('traduce %s del dominio in %i', async (code, status) => {
    updateMock.mockResolvedValue({ ok: false, code })

    const response = await put(validBody)

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
  })

  it('un guasto interno non espone dettagli', async () => {
    updateMock.mockRejectedValue(new Error('db password leaked'))

    const response = await put(validBody)

    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('leaked')
  })
})
