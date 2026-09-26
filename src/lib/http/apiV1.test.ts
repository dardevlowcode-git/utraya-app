/* Commento didattico:
 * Scopo del file: verifica i contratti deterministici dell'envelope API v1 senza chiamare provider o database.
 * Moduli richiamati: `./apiV1`, `@/lib/utils/errors`, `vitest`.
 * Flusso: testa requestId, validazione e sanitizzazione degli errori prima delle suite live.
 */

import { describe, expect, it } from 'vitest'
import { apiV1Error, apiV1NotFound, apiV1Validation } from './apiV1'
import { AppError } from '@/lib/utils/errors'

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('API v1 helpers', () => {
  it('returns the standard validation envelope and request header', async () => {
    const response = apiV1Validation('campo mancante', 'req-1')
    expect(response.status).toBe(400)
    expect(response.headers.get('X-Request-Id')).toBe('req-1')
    await expect(json(response)).resolves.toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'campo mancante' },
      requestId: 'req-1',
    })
  })

  it('maps ownership errors without exposing internals', async () => {
    const response = apiV1Error(new AppError('Canale non disponibile', 'forbidden', 403), 'req-2')
    expect(response.status).toBe(403)
    await expect(json(response)).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Canale non disponibile' },
      requestId: 'req-2',
    })
  })

  it('hides internal service details', async () => {
    const response = apiV1Error(new AppError('secret provider detail', 'unknown', 500), 'req-3')
    await expect(json(response)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Errore interno' },
      requestId: 'req-3',
    })
  })

  it('returns a typed not-found response', async () => {
    const response = apiV1NotFound('Risorsa assente', 'req-4')
    expect(response.status).toBe(404)
    await expect(json(response)).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Risorsa assente' },
    })
  })
})
