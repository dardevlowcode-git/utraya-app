/* Commento didattico:
 * Scopo del file: shell client condivisa per area privata, con gestione sidebar collassabile/pinnabile su desktop e drawer su mobile.
 * Moduli richiamati: componenti layout, hook React, utility `cn` e tipo sessione auth.
 * Flusso: legge preferenza pin da localStorage, sincronizza stato con viewport e calcola offset contenuto quando la sidebar e` fissata.
 */

'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AuthSession } from '@/lib/types/domain'
import TopNav from '@/components/layout/TopNav'
import SideNav from '@/components/layout/SideNav'
import { cn } from '@/lib/utils/cn'

const PIN_STORAGE_KEY = 'private-nav-pinned'
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)'

interface PrivateChromeProps {
  session: AuthSession
  children: React.ReactNode
  footer: React.ReactNode
}

export default function PrivateChrome({ session, children, footer }: PrivateChromeProps) {
  const [isDesktop, setIsDesktop] = useState(false)
  const [isPinned, setIsPinned] = useState(true)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY)
    const syncViewport = () => {
      setIsDesktop(media.matches)
      if (!media.matches) {
        setIsMenuOpen(false)
      }
    }

    const savedPinned = window.localStorage.getItem(PIN_STORAGE_KEY)
    if (savedPinned === '0') {
      setIsPinned(false)
    }

    syncViewport()
    media.addEventListener('change', syncViewport)

    return () => {
      media.removeEventListener('change', syncViewport)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PIN_STORAGE_KEY, isPinned ? '1' : '0')
  }, [isPinned])

  const contentOffsetClass = useMemo(() => {
    return isDesktop && isPinned ? 'md:ml-64' : ''
  }, [isDesktop, isPinned])

  function toggleMenu() {
    setIsMenuOpen((previous) => !previous)
  }

  function closeMenu() {
    setIsMenuOpen(false)
  }

  function togglePinned() {
    setIsPinned((previous) => {
      const next = !previous
      if (!previous) {
        setIsMenuOpen(false)
      }
      return next
    })
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <TopNav variant="private" session={session} />
      <div className="flex flex-1 pt-16">
        <SideNav
          session={session}
          isDesktop={isDesktop}
          isPinned={isPinned}
          isOpen={isMenuOpen}
          onToggleMenu={toggleMenu}
          onCloseMenu={closeMenu}
          onTogglePinned={togglePinned}
        />
        <main className={cn('min-h-full flex-1 transition-[margin] duration-200', contentOffsetClass)}>{children}</main>
      </div>
      <div className={cn('transition-[margin] duration-200', contentOffsetClass)}>{footer}</div>
    </div>
  )
}

