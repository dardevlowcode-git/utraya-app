/* Commento didattico:
 * Scopo: protegge le etichette visibili e le distanze touch della navigazione admin mobile.
 * Moduli richiamati: `AdminSideNav`, mock dei router hook e renderer React server-side.
 * Flusso: verifica larghezza responsive e nomi leggibili da tecnologie assistive per le destinazioni.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
      React.createElement('a', { href, ...props }, children),
  }
})
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/videos' }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

import AdminSideNav from './AdminSideNav'

describe('AdminSideNav', () => {
  it('keeps admin destinations labelled and spaced in the mobile rail', () => {
    const markup = renderToStaticMarkup(createElement(AdminSideNav))

    expect(markup).toMatch(/class="[^"]*w-24[^"]*md:w-64/)
    expect(markup).toContain('aria-label="admin.title"')
    expect(markup).toContain('title="admin.content.title"')
    expect(markup).toContain('href="/admin/retry-limits"')
    expect(markup).toContain('title="admin.retryLimits.title"')
    expect(markup).toContain('title="admin.backToApp"')
    expect(markup).toContain('class="flex-1 space-y-2 overflow-y-auto px-2 md:space-y-1 md:px-3"')
    expect(markup).toContain('class="text-center md:text-left">admin.content.title</span>')
    expect(markup).toContain('class="text-center md:text-left">admin.retryLimits.title</span>')
    expect(markup).toContain('class="text-center md:text-left">admin.backToApp</span>')
  })
})
