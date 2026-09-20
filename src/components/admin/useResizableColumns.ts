/* Commento didattico:
 * Scopo del file: hook riutilizzabile per colonne ridimensionabili in griglie tabellari.
 * Moduli richiamati: `react`
 * Flusso: mantiene le larghezze, aggancia eventi mouse globali durante il drag e restituisce handler pronti per l'UI.
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface UseResizableColumnsOptions {
  minWidth?: number
}

/**
 * Gestisce resize di colonne adiacenti mantenendo la larghezza totale.
 */
export function useResizableColumns(
  initialWidths: number[],
  options?: UseResizableColumnsOptions
) {
  const minWidth = options?.minWidth ?? 80
  const [widths, setWidths] = useState<number[]>(initialWidths)
  const dragStateRef = useRef<{ index: number; startX: number } | null>(null)

  const onStartResize = useCallback((index: number, clientX: number) => {
    dragStateRef.current = { index, startX: clientX }
  }, [])

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current
      if (!dragState) return

      const { index, startX } = dragState
      const deltaX = event.clientX - startX
      if (deltaX === 0) return

      setWidths((current) => {
        if (index < 0 || index >= current.length - 1) return current
        const next = [...current]
        const left = next[index]
        const right = next[index + 1]
        const candidateLeft = left + deltaX
        const candidateRight = right - deltaX
        if (candidateLeft < minWidth || candidateRight < minWidth) return current
        next[index] = candidateLeft
        next[index + 1] = candidateRight
        return next
      })

      dragStateRef.current = { index, startX: event.clientX }
    }

    function onMouseUp() {
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [minWidth])

  const templateColumns = useMemo(
    () => widths.map((w) => `${Math.max(w, minWidth)}px`).join(' '),
    [widths, minWidth]
  )

  return {
    widths,
    templateColumns,
    onStartResize,
  }
}
