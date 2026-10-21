/* Commento didattico:
 * Scopo: verifica snapshot SSR stabile per viewport, preferenza sidebar e drawer.
 * Moduli richiamati: `PrivateChrome`, renderer React server-side e `vitest`.
 * Flusso: neutralizza la navigazione e osserva i valori passati alla sidebar.
 */

// @vitest-environment happy-dom

import { act, createElement, type ComponentProps, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHydrated } from '@/__tests__/client-render'

type TestSideNavProps = {
  isDesktop: boolean
  isPinned: boolean
  isOpen: boolean
  onToggleMenu: () => void
  onTogglePinned: () => void
}

vi.mock('@/components/layout/TopNav', () => ({ default: () => null }))
vi.mock('@/components/layout/SideNav', async () => {
  const React = await import('react')
  return {
    default: (props: TestSideNavProps) => React.createElement('nav', null,
      React.createElement('output', { 'data-testid': 'sidebar-state' },
        `viewport=${props.isDesktop ? 'desktop' : 'mobile'};pinned=${props.isPinned};menu=${props.isOpen ? 'open' : 'closed'}`
      ),
      React.createElement('button', { type: 'button', 'data-testid': 'toggle-menu', onClick: props.onToggleMenu }, 'Menu'),
      React.createElement('button', { type: 'button', 'data-testid': 'toggle-pinned', onClick: props.onTogglePinned }, 'Pin')
    ),
  }
})

import PrivateChrome from './PrivateChrome'

const PrivateChromeForTest = PrivateChrome as ComponentType<Omit<ComponentProps<typeof PrivateChrome>, 'children'>>

type MatchMediaHarness = {
  media: MediaQueryList
  setMatches: (matches: boolean) => void
  restore: () => void
}

/** Installa una media query osservabile per testare le transizioni di viewport. */
function installMatchMedia(matches = false): MatchMediaHarness {
  const listeners = new Set<(event: Event) => void>()
  const media = {
    matches,
    media: '(min-width: 768px)',
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(typeof listener === 'function' ? listener : (event) => listener.handleEvent(event))
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(typeof listener === 'function' ? listener : (event) => listener.handleEvent(event))
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: (event: Event) => {
      listeners.forEach((listener) => listener(event))
      return true
    },
  } as unknown as MediaQueryList
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media })

  return {
    media,
    setMatches(nextMatches) {
      ;(media as MediaQueryList & { matches: boolean }).matches = nextMatches
      media.dispatchEvent(new Event('change'))
    },
    restore() {
      if (previousDescriptor) {
        Object.defineProperty(window, 'matchMedia', previousDescriptor)
      } else {
        delete (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia
      }
    },
  }
}

/** Crea la stessa shell usata dai due test, con il markup che la mock sidebar osserva. */
function privateChromeElement() {
  return createElement(PrivateChromeForTest, {
    session: {} as never,
    footer: createElement('footer', null, 'Piè di pagina'),
  }, createElement('p', null, 'Contenuto'))
}

/** Legge lo stato osservabile reso dalla sidebar di test. */
function sidebarState(container: HTMLElement) {
  return container.querySelector('[data-testid="sidebar-state"]')?.textContent ?? ''
}

afterEach(() => {
  window.localStorage.clear()
})

describe('PrivateChrome', () => {
  it('usa i default mobile e fissati nello snapshot server', () => {
    const markup = renderToStaticMarkup(privateChromeElement())

    expect(markup).toContain('viewport=mobile;pinned=true;menu=closed')
    expect(markup).not.toContain('md:ml-64')
  })

  it('persists the sidebar toggle and closes the drawer when returning to mobile', async () => {
    const media = installMatchMedia()
    window.localStorage.setItem('private-nav-pinned', '0')
    const mounted = await renderHydrated(privateChromeElement())

    try {
      expect(sidebarState(mounted.container)).toBe('viewport=mobile;pinned=false;menu=closed')

      await act(async () => mounted.container.querySelector<HTMLButtonElement>('[data-testid="toggle-menu"]')?.click())
      expect(sidebarState(mounted.container)).toBe('viewport=mobile;pinned=false;menu=open')

      await act(async () => mounted.container.querySelector<HTMLButtonElement>('[data-testid="toggle-pinned"]')?.click())
      expect(window.localStorage.getItem('private-nav-pinned')).toBe('1')
      expect(sidebarState(mounted.container)).toBe('viewport=mobile;pinned=true;menu=closed')

      await act(async () => mounted.container.querySelector<HTMLButtonElement>('[data-testid="toggle-pinned"]')?.click())
      expect(window.localStorage.getItem('private-nav-pinned')).toBe('0')
      expect(sidebarState(mounted.container)).toBe('viewport=mobile;pinned=false;menu=closed')

      await act(async () => mounted.container.querySelector<HTMLButtonElement>('[data-testid="toggle-menu"]')?.click())
      await act(async () => media.setMatches(true))
      expect(sidebarState(mounted.container)).toBe('viewport=desktop;pinned=false;menu=open')

      await act(async () => media.setMatches(false))
      expect(sidebarState(mounted.container)).toBe('viewport=mobile;pinned=false;menu=closed')
    } finally {
      await mounted.unmount()
      media.restore()
    }
  })
})
