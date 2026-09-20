/* Commento didattico:
 * Scopo del file: top navigation condivisa per superfici pubblica, privata e admin con menu utente touch-safe.
 * Moduli richiamati: `next/link`, `next-intl`, supabase client, routing client.
 * Flusso: mostra nav contestuale, azioni utente e gestione logout in base al variant corrente.
 */

'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { AuthSession } from '@/lib/types/domain'
import ThemeToggle from '@/components/theme/ThemeToggle'
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher'

interface TopNavProps {
  variant: 'public' | 'private' | 'admin'
  session?: AuthSession | null
}

export default function TopNav({ variant, session }: TopNavProps) {
  const t = useTranslations()
  const router = useRouter()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isUserMenuOpen) return

    function onOutsideClick(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false)
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsUserMenuOpen(false)
    }

    document.addEventListener('mousedown', onOutsideClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutsideClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [isUserMenuOpen])

  async function handleSignOut() {
    if (variant === 'admin') {
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      router.push('/admin/login')
      router.refresh()
      return
    }

    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <header className="shell-header fixed left-0 right-0 top-0 z-50">
      <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6 lg:gap-8">
          <Link href={session ? '/dashboard' : '/'} className="shell-logo">
            UTRAYA
          </Link>

          {variant === 'private' && (
            <nav className="shell-nav-pill hidden items-center gap-2 lg:flex">
              <NavLink href="/dashboard">{t('nav.dashboard')}</NavLink>
              <NavLink href="/channels">{t('nav.channels')}</NavLink>
              <NavLink href="/traker">{t('nav.traker')}</NavLink>
              <NavLink href="/watchlist">{t('nav.watchlist')}</NavLink>
              <NavLink href="/integrations">{t('nav.integrations')}</NavLink>
            </nav>
          )}

          {variant === 'admin' && (
            <div className="shell-nav-pill hidden items-center gap-3 md:flex">
              <span className="font-headline text-sm font-bold text-on-surface-variant">{t('admin.superAdmin')}</span>
              <span className="rounded-full bg-secondary-fixed px-2 py-0.5 text-label-caps text-on-secondary-fixed">Admin</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <LanguageSwitcher />
          <ThemeToggle />

          {variant === 'public' && (
            <Link href="/login" className="shell-cta-default">
              {t('nav.login')}
            </Link>
          )}

          {(variant === 'private' || variant === 'admin') && session && (
            <>
              <button
                className="rounded-xl border border-stroke-subtle p-2 text-on-surface-variant transition-colors hover:bg-surface-elevated"
                aria-label={t('common.notifications')}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                  />
                </svg>
              </button>

              <Link
                href="/settings/account"
                className="rounded-xl border border-stroke-subtle p-2 text-on-surface-variant transition-colors hover:bg-surface-elevated"
                aria-label={t('common.settings')}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>

              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen((previous) => !previous)}
                  aria-expanded={isUserMenuOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-full border border-stroke-subtle p-1 transition-shadow hover:shadow-soft"
                >
                  {session.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.avatarUrl} alt={session.displayName ?? 'Profilo'} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full gradient-ai text-sm font-bold text-white">
                      {(session.displayName ?? session.email)[0].toUpperCase()}
                    </div>
                  )}
                </button>

                {isUserMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-stroke-subtle bg-surface-statement py-1 shadow-medium">
                    <div className="border-b border-stroke-subtle px-4 py-2">
                      <p className="truncate text-sm font-semibold text-on-surface">{session.displayName ?? session.email}</p>
                      <p className="truncate text-xs text-on-surface-variant">{session.email}</p>
                    </div>

                    {variant === 'private' && session.role === 'super_admin' && (
                      <Link
                        href="/admin"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="block px-4 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-elevated"
                      >
                        {t('nav.admin')}
                      </Link>
                    )}

                    <button
                      onClick={handleSignOut}
                      className="w-full px-4 py-2 text-left text-sm text-error transition-colors hover:bg-error-container/20"
                    >
                      {t('nav.logout')}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="shell-nav-link">
      {children}
    </Link>
  )
}
