import { describe, expect, it } from 'vitest'
import { ensureJsonRequest, ensureSameOrigin, getClientIp, getRequestId } from './http'
import { AppError } from '@/lib/utils/errors'

const uuidV4 = '123e4567-e89b-42d3-a456-426614174000'

function request(url = 'https://utraya.com/api/x', headers: Record<string, string> = {}) {
  return new Request(url, { headers })
}

function expectAppError(fn: () => unknown, statusCode: number, type: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).statusCode).toBe(statusCode)
    expect((error as AppError).type).toBe(type)
    return
  }
  throw new Error('Atteso AppError, nessuna eccezione lanciata')
}

describe('ensureSameOrigin', () => {
  it('accetta una origin uguale a quella della richiesta', () => {
    expect(() => ensureSameOrigin(request('https://utraya.com/api/x', { origin: 'https://utraya.com' }))).not.toThrow()
  })

  it('rifiuta una origin assente con 403', () => {
    expectAppError(() => ensureSameOrigin(request()), 403, 'forbidden')
  })

  it('rifiuta una origin diversa con 403', () => {
    expectAppError(() => ensureSameOrigin(request('https://utraya.com/api/x', { origin: 'https://evil.example' })), 403, 'forbidden')
  })

  it('rifiuta origin "null" con 403', () => {
    expectAppError(() => ensureSameOrigin(request('https://utraya.com/api/x', { origin: 'null' })), 403, 'forbidden')
  })
})

describe('ensureJsonRequest', () => {
  it('accetta application/json', () => {
    expect(() => ensureJsonRequest(request('https://utraya.com/api/x', { 'content-type': 'application/json' }))).not.toThrow()
  })

  it('accetta application/json con charset', () => {
    expect(() =>
      ensureJsonRequest(request('https://utraya.com/api/x', { 'content-type': 'application/json; charset=utf-8' }))
    ).not.toThrow()
  })

  it('rifiuta un content-type non JSON con 415', () => {
    expectAppError(() => ensureJsonRequest(request('https://utraya.com/api/x', { 'content-type': 'text/plain' })), 415, 'validation')
  })

  it('rifiuta il content-type assente con 415', () => {
    expectAppError(() => ensureJsonRequest(request()), 415, 'validation')
  })
})

describe('getClientIp', () => {
  it('usa x-real-ip', () => {
    expect(getClientIp(request('https://utraya.com/api/x', { 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('ignora x-forwarded-for', () => {
    expect(getClientIp(request('https://utraya.com/api/x', { 'x-forwarded-for': '198.51.100.1' }))).toBeNull()
  })

  it('preferisce x-real-ip quando entrambi sono presenti', () => {
    const req = request('https://utraya.com/api/x', { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })
    expect(getClientIp(req)).toBe('203.0.113.7')
  })

  it('ritorna null quando x-real-ip è assente o vuoto', () => {
    expect(getClientIp(request())).toBeNull()
    expect(getClientIp(request('https://utraya.com/api/x', { 'x-real-ip': '   ' }))).toBeNull()
  })
})

describe('getRequestId', () => {
  it('accetta un UUID v4 valido', () => {
    expect(getRequestId(request('https://utraya.com/api/x', { 'x-request-id': uuidV4 }))).toBe(uuidV4)
  })

  it('genera un nuovo UUID se l\'header è assente', () => {
    expect(getRequestId(request())).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('scarta un UUID di versione diversa dalla 4', () => {
    const uuidV1 = '123e4567-e89b-12d3-a456-426614174000'
    const result = getRequestId(request('https://utraya.com/api/x', { 'x-request-id': uuidV1 }))
    expect(result).not.toBe(uuidV1)
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('scarta un valore non UUID', () => {
    const result = getRequestId(request('https://utraya.com/api/x', { 'x-request-id': 'not-a-uuid' }))
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})