// @vitest-environment happy-dom

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import AdminLoginPage from './page'

describe('pagina login admin', () => {
  it('mantiene lo username per i password manager ma ne maschera il testo', () => {
    const markup = renderToStaticMarkup(createElement(AdminLoginPage))
    const container = document.createElement('div')
    container.innerHTML = markup
    const username = container.querySelector<HTMLInputElement>('#username')

    expect(username).not.toBeNull()
    expect(username?.type).toBe('text')
    expect(username?.getAttribute('autocomplete')).toBe('username')
    expect(username?.classList.contains('[-webkit-text-security:disc]')).toBe(true)
    expect(username?.getAttribute('spellcheck')).toBe('false')
    expect(username?.getAttribute('autocapitalize')).toBe('none')
    expect(username?.getAttribute('autocorrect')).toBe('off')
  })

  it('mantiene il campo password come password', () => {
    const markup = renderToStaticMarkup(createElement(AdminLoginPage))
    const container = document.createElement('div')
    container.innerHTML = markup
    const password = container.querySelector<HTMLInputElement>('#password')

    expect(password?.type).toBe('password')
  })
})
