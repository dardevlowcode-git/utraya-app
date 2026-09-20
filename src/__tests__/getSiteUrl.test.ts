/* Commento didattico:
 * Scopo del file: verifica il comportamento degli helper env-aware per costruzione URL sito.
 * Moduli richiamati: `@/lib/env/getSiteUrl`, `vitest`.
 * Flusso: i test validano precedence env/fallback e normalizzazione path per redirect/callback.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSiteUrl, getSiteUrl } from '@/lib/env/getSiteUrl'

/**
 * Ripristina lo stato env tra i test per evitare leakage.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getSiteUrl', () => {
  it('ritorna NEXT_PUBLIC_SITE_URL quando e settata', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.utraya.com')
    expect(getSiteUrl()).toBe('https://preview.utraya.com')
  })

  it('rimuove trailing slash da NEXT_PUBLIC_SITE_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.utraya.com/')
    expect(getSiteUrl()).toBe('https://preview.utraya.com')
  })

  it('usa localhost in ambiente node quando env non e settata', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    expect(getSiteUrl()).toBe('http://localhost:3000')
  })
})

describe('buildSiteUrl', () => {
  it('compone URL con path gia slash-prefixed', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.utraya.com')
    expect(buildSiteUrl('/auth/callback')).toBe('https://preview.utraya.com/auth/callback')
  })

  it('normalizza path senza slash iniziale', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.utraya.com')
    expect(buildSiteUrl('auth/callback')).toBe('https://preview.utraya.com/auth/callback')
  })
})
