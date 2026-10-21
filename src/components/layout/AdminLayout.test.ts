/* Commento didattico:
 * Scopo: protegge la geometria responsive della shell admin nei markup renderizzati.
 * Moduli richiamati: layout admin, mock auth e renderer React server-side.
 * Flusso: verifica che il rail mobile non riservi spazio desktop e che main/footer possano restringersi.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdminSessionMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({ getAdminSession: getAdminSessionMock }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/components/layout/TopNav', () => ({ default: () => null }))
vi.mock('@/components/layout/AdminSideNav', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))

import AdminLayout from '@/app/(admin)/admin/layout'

beforeEach(() => {
  getAdminSessionMock.mockResolvedValue({ username: 'admin-fixture' })
})

describe('AdminLayout', () => {
  it('uses a narrow mobile rail and lets the content column shrink without losing desktop alignment', async () => {
    const markup = renderToStaticMarkup(await AdminLayout({
      children: createElement('section', null, 'Contenuto admin'),
    }))

    expect(markup).toContain('class="min-w-0 flex-1 ml-24 md:ml-64 min-h-full"')
    expect(markup).toContain('<div class="ml-24 md:ml-64"></div>')
  })
})
