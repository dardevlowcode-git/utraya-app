/* Commento didattico:
 * Scopo: verifica precedenza della preferenza tema e snapshot stabile durante SSR.
 * Moduli richiamati: `ThemeToggle`, renderer React server-side e `vitest`.
 * Flusso: controlla la scelta di tema e che il markup iniziale resti chiaro per hydration.
 */

// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHydrated } from '@/__tests__/client-render'
import ThemeToggle, { resolveTheme } from './ThemeToggle'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.cookie = 'theme=; path=/; max-age=0'
})

describe('ThemeToggle', () => {
  it('preferisce il tema memorizzato e usa il tema HTML come fallback', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark')
    expect(resolveTheme('invalid', 'dark')).toBe('dark')
    expect(resolveTheme(null, 'invalid')).toBe('light')
  })

  it('mantiene il tema chiaro nello snapshot server iniziale', () => {
    const markup = renderToStaticMarkup(createElement(ThemeToggle))

    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('common.theme.normal')
  })

  it('idrata la preferenza esistente e persiste ogni scelta fatta dai pulsanti', async () => {
    window.localStorage.setItem('utraya-theme', 'dark')
    document.documentElement.setAttribute('data-theme', 'light')
    const mounted = await renderHydrated(createElement(ThemeToggle))

    try {
      const [normalButton, darkButton] = mounted.container.querySelectorAll('button')
      expect(darkButton.getAttribute('aria-pressed')).toBe('true')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      expect(window.localStorage.getItem('utraya-theme')).toBe('dark')
      expect(document.cookie.split('; ').some((cookie) => cookie === 'theme=dark')).toBe(true)

      await act(async () => normalButton.click())
      expect(normalButton.getAttribute('aria-pressed')).toBe('true')
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(window.localStorage.getItem('utraya-theme')).toBe('light')
      expect(document.cookie.split('; ').some((cookie) => cookie === 'theme=light')).toBe(true)

      await act(async () => darkButton.click())
      expect(darkButton.getAttribute('aria-pressed')).toBe('true')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      expect(window.localStorage.getItem('utraya-theme')).toBe('dark')
    } finally {
      await mounted.unmount()
    }
  })
})
