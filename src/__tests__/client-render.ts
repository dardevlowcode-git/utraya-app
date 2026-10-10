/* Commento didattico:
 * Scopo: fornisce mount, hydration e aggiornamento client per test React comportamentali.
 * Moduli richiamati: React `act`, renderer server e root client.
 * Flusso: genera markup SSR, lo idrata nel DOM e restituisce controlli di test isolati.
 */

import { act, type ReactElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

type HydratedClientRender = {
  container: HTMLDivElement
  rerender: (element: ReactElement) => Promise<void>
  unmount: () => Promise<void>
}

type HydratedClientRenderOptions = {
  attachToDocument?: boolean
}

/** Idrata un elemento React partendo dal suo markup SSR e rende accessibile il root client. */
export async function renderHydrated(
  element: ReactElement,
  options: HydratedClientRenderOptions = {}
): Promise<HydratedClientRender> {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  const container = document.createElement('div')
  container.innerHTML = renderToString(element)
  if (options.attachToDocument !== false) document.body.append(container)

  const rootRef: { current: Root | null } = { current: null }
  await act(async () => {
    rootRef.current = hydrateRoot(container, element)
  })
  const hydratedRoot = rootRef.current
  if (!hydratedRoot) throw new Error('React root was not hydrated')

  return {
    container,
    async rerender(nextElement) {
      await act(async () => hydratedRoot.render(nextElement))
    },
    async unmount() {
      await act(async () => hydratedRoot.unmount())
      container.remove()
    },
  }
}
