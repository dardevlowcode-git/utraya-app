/* Commento didattico:
 * Scopo del file: sidebar privata con modalita` pinnata desktop e drawer mobile collassabile.
 * Moduli richiamati: routing Next, traduzioni, utility classnames e tipo sessione.
 * Flusso: mostra un pulsante flottante per apertura menu, consente pin/unpin e chiude automaticamente la modalita` overlay dopo navigazione.
 */

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { AuthSession } from '@/lib/types/domain'
import { cn } from '@/lib/utils/cn'

interface SideNavProps {
  session: AuthSession
  isDesktop: boolean
  isPinned: boolean
  isOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  onTogglePinned: () => void
}

export default function SideNav({
  session,
  isDesktop,
  isPinned,
  isOpen,
  onToggleMenu,
  onCloseMenu,
  onTogglePinned,
}: SideNavProps) {
  const t = useTranslations()
  const pathname = usePathname()

  const mainItems = [
    {
      href: '/dashboard',
      label: t('nav.dashboard'),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
          />
        </svg>
      ),
    },
    {
      href: '/channels',
      label: t('nav.channels'),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
          />
        </svg>
      ),
    },
    {
      href: '/traker',
      label: t('nav.traker'),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75a3 3 0 013-3h10.5a3 3 0 013 3v10.5a3 3 0 01-3 3H6.75a3 3 0 01-3-3V6.75z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 7.5h3v3h-3v-3zm0 6h3v3h-3v-3zm6-6h3v3h-3v-3z" />
        </svg>
      ),
    },
    {
      href: '/watchlist',
      label: t('nav.watchlist'),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
          />
        </svg>
      ),
    },
    {
      href: '/integrations',
      label: t('nav.integrations'),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
          />
        </svg>
      ),
    },
  ]

  const bottomItems = [
    {
      href: '/help',
      label: t('nav.help'),
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
          />
        </svg>
      ),
    },
  ]

  const isVisible = isPinned ? isDesktop : isOpen
  const showOverlay = isOpen && (!isDesktop || !isPinned)

  function handleNavClick() {
    if (!isDesktop || !isPinned) {
      onCloseMenu()
    }
  }

  return (
    <>
      {!isVisible && (
        <button
          type="button"
          onClick={onToggleMenu}
          className="fixed left-4 top-[4.75rem] z-50 inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-medium transition-colors hover:bg-primary-container"
          aria-label={t('common.openSideMenu')}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      )}

      {showOverlay && (
        <button
          type="button"
          aria-label={t('common.close')}
          className="bg-scrim fixed inset-0 z-40 backdrop-blur-[1px]"
          onClick={onCloseMenu}
        />
      )}

      <aside
        className={cn(
          'fixed bottom-0 top-16 z-50 flex w-64 flex-col bg-surface-container-low transition-transform duration-200',
          isPinned && isDesktop ? 'left-0 translate-x-0 border-r border-surface-container-high' : '',
          !isPinned && isDesktop ? 'left-0 shadow-medium' : '',
          !isDesktop ? 'left-0 shadow-medium' : '',
          showOverlay ? 'translate-x-0' : !isPinned ? '-translate-x-full' : ''
        )}
      >
        <div className="flex items-center justify-between px-4 pb-4 pt-6">
          <p className="px-3 text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
            {t('nav.channels')}
          </p>
          <button
            type="button"
            onClick={onTogglePinned}
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              isPinned ? 'bg-primary text-on-primary hover:bg-primary-container' : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
            )}
            aria-pressed={isPinned}
            aria-label={isPinned ? t('common.unpinSideMenu') : t('common.pinSideMenu')}
          >
            <svg className={cn('h-4 w-4 transition-transform', isPinned ? '' : '-rotate-12')} viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 3l7 7-2 2-2.5-2.5-3.75 3.75 3.75 3.75-1.5 1.5-3.75-3.75L7.5 18 5 15.5l3.75-3.75L6.25 9.25 8.25 7.25 14 3zM3 21l6-6" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {mainItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200',
                  isActive ? 'translate-x-0.5 bg-surface-container-lowest text-primary shadow-ambient-md' : 'text-on-surface-variant hover:translate-x-1 hover:bg-surface-container'
                )}
              >
                <span className={cn(isActive ? 'text-primary' : 'text-on-surface-variant')}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="space-y-1 border-t border-surface-container-high px-3 py-4">
          {session.role === 'super_admin' && (
            <Link
              href="/admin"
              onClick={handleNavClick}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-tertiary transition-all hover:bg-tertiary-fixed/30"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
              {t('nav.admin')}
            </Link>
          )}
          {bottomItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleNavClick}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-on-surface-variant transition-all hover:bg-surface-container"
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </div>
      </aside>
    </>
  )
}
