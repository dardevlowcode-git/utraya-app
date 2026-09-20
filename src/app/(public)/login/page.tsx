/* Commento didattico:
 * Scopo del file: pagina login pubblica con avvio OAuth Google e gestione errori callback inclusi stato cancellazione account.
 * Moduli richiamati: next-intl, supabase client, site-url helper, next/navigation.
 * Flusso: costruisce redirect OAuth sicuro verso callback e mostra eventuali errori rientrati da querystring.
 */

'use client'

import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { buildSiteUrl } from '@/lib/env/getSiteUrl'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'

function LoginForm() {
  const t = useTranslations()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const redirectToParam = searchParams.get('redirectTo')
  const redirectTo = redirectToParam && redirectToParam !== '/' ? redirectToParam : '/dashboard'

  async function handleGoogleLogin() {
    const supabase = createClient()
    const callbackUrl = new URL(buildSiteUrl('/api/auth/callback'))
    callbackUrl.searchParams.set('redirectTo', redirectTo)

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl.toString(),
      },
    })
  }

  const errorMessages: Record<string, string> = {
    access_denied: t('auth.accessDeniedDetail'),
    exchange_failed: t('auth.exchangeFailed'),
    no_user: t('auth.noUser'),
    no_code: t('auth.noCode'),
    deletion_pending: t('auth.deletionPending'),
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary opacity-[0.05] rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-tertiary opacity-[0.06] rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="bg-surface-container-lowest rounded-3xl shadow-ambient p-10">
          <div className="text-center mb-8">
            <span className="font-headline text-4xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-primary to-tertiary">
              Utraya
            </span>
            <p className="text-on-surface-variant mt-2 text-sm">{t('auth.loginSubtitle')}</p>
          </div>

          {error && errorMessages[error] && (
            <div className="mb-6 px-4 py-3 bg-error-container rounded-xl border border-error/10">
              <p className="text-sm text-error font-medium">{errorMessages[error]}</p>
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 gradient-primary text-on-primary
                       px-6 py-4 rounded-full font-bold text-base
                       hover:shadow-primary-glow transition-all active:scale-95"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z" />
            </svg>
            {t('auth.loginWithGoogle')}
          </button>

          <Link
            href="/admin/login"
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full
                       font-semibold text-sm border border-outline-variant/40 text-on-surface-variant
                       hover:bg-surface-container-low transition-all"
          >
            {t('auth.admin.loginLink')}
          </Link>

          <div className="mt-6 p-4 bg-surface-container-low rounded-xl">
            <p className="text-xs text-on-surface-variant text-center leading-relaxed">
              <strong className="text-on-surface">{t('auth.inviteOnly')}</strong> {t('auth.inviteOnlyDetail')}
            </p>
          </div>

          <div className="text-center mt-6">
            <Link href="/" className="text-sm text-on-surface-variant hover:text-on-surface transition-colors">
              ← {t('auth.backToHome')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface flex items-center justify-center">
          <div className="skeleton w-96 h-64 rounded-3xl" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}