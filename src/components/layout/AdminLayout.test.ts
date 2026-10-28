import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdminSessionMock, redirectMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock('@/lib/auth/admin', () => ({ getAdminSession: getAdminSessionMock }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@/components/layout/TopNav', () => ({ default: () => null }))
vi.mock('@/components/layout/AdminSideNav', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))

import AdminLayout from '@/app/(admin)/admin/layout'

beforeEach(() => {
  getAdminSessionMock.mockResolvedValue({ username: 'admin-fixture' })
})

describe('AdminLayout', () => {
  it('reindirizza al login e non rende i figli senza sessione admin', async () => {
    getAdminSessionMock.mockResolvedValueOnce(null)

    await expect(async () => renderToStaticMarkup(await AdminLayout({
      children: createElement('section', null, 'Contenuto admin'),
    }))).rejects.toThrow('NEXT_REDIRECT:/admin/login')

    expect(redirectMock).toHaveBeenCalledWith('/admin/login')
  })

  it('rende i figli con una sessione admin valida', async () => {
    const markup = renderToStaticMarkup(await AdminLayout({
      children: createElement('section', null, 'Contenuto admin'),
    }))

    expect(markup).toContain('<section>Contenuto admin</section>')
  })
})
