/* Commento didattico:
 * Scopo del file: verifica estrazione allowlisted e redazione dei dati diagnostici transcript.
 * Moduli richiamati: helper sanitizzazione/parser errori del servizio transcript.
 * Flusso: usa fixture sintetiche per controllare reason, timeout, URL e segreti senza rete.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  classifyDiagnosticError,
  extractPlayerDiagnosticFields,
  sanitizeDiagnosticText,
} from '@/lib/services/transcript-diagnostics'

describe('transcript diagnostic sanitization', () => {
  beforeEach(() => {
    process.env.YOUTUBEI_API_KEY = 'unit-test-api-key'
  })

  it('conserva reason e subreason allowlisted dalla risposta player', () => {
    const fields = extractPlayerDiagnosticFields({
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to continue',
        errorScreen: {
          errorCode: 'LOGIN_REQUIRED',
          playerErrorMessageRenderer: {
            subreason: { runs: [{ text: 'Confirm this request' }] },
          },
        },
      },
    })

    expect(fields).toEqual({
      playability_status: 'LOGIN_REQUIRED',
      player_reason: 'Sign in to continue',
      player_subreason: 'Confirm this request',
      player_error_code: 'LOGIN_REQUIRED',
      player_error_message: 'Sign in to continue',
    })
  })

  it('rimuove URL, query credentials, bearer, API key e control characters', () => {
    const value = [
      'Reason',
      'https://www.youtube.com/player?key=unit-test-api-key&sig=signed-value',
      'Bearer bearer-secret',
      'Authorization: Basic basic-secret',
      'Cookie: SID=cookie-secret; HSID=second-cookie-secret',
      'password=password-secret',
      'refresh_token=refresh-secret',
      '{"authorization":"Basic json-basic-secret","cookie":"SID=json-cookie-secret","password":"json-password-secret"}',
    ].join('\n')
    const sanitized = sanitizeDiagnosticText(value)

    expect(sanitized).toContain('Reason')
    expect(sanitized).not.toContain('youtube.com')
    expect(sanitized).not.toContain('unit-test-api-key')
    expect(sanitized).not.toContain('signed-value')
    expect(sanitized).not.toContain('bearer-secret')
    expect(sanitized).not.toContain('basic-secret')
    expect(sanitized).not.toContain('cookie-secret')
    expect(sanitized).not.toContain('second-cookie-secret')
    expect(sanitized).not.toContain('password-secret')
    expect(sanitized).not.toContain('refresh-secret')
    expect(sanitized).not.toContain('json-basic-secret')
    expect(sanitized).not.toContain('json-cookie-secret')
    expect(sanitized).not.toContain('json-password-secret')
    expect(sanitized).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
  })

  it('classifica timeout e rete senza serializzare l errore originale', () => {
    const timeout = classifyDiagnosticError(Object.assign(new Error('request timed out'), { name: 'TimeoutError' }))
    const network = classifyDiagnosticError(Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET' },
    }))

    expect(timeout.outcome).toBe('timeout')
    expect(network).toMatchObject({ outcome: 'network_error', error_code: 'ECONNRESET' })
  })
})
