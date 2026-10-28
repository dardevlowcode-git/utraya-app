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
