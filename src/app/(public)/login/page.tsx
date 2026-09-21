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
            className="btn-google"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
              <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
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