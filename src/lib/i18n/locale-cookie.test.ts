/* Commento didattico:
 * Scopo: verifica che il cambio lingua persista la preferenza nel cookie del sito.
 * Moduli richiamati: helper del cookie lingua e `vitest`.
 * Flusso: sostituisce `document` con un target minimo e controlla il cookie scritto.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeLocaleCookie } from './locale-cookie'

describe('writeLocaleCookie', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persiste la lingua richiesta con il percorso e la durata correnti', () => {
    const documentStub = { cookie: '' }
    vi.stubGlobal('document', documentStub)

    writeLocaleCookie('en')

    expect(documentStub.cookie).toBe('NEXT_LOCALE=en; path=/; max-age=31536000; samesite=lax')
  })
})
