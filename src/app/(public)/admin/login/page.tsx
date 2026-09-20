/* Commento didattico:
 * Scopo del file: definisce una pagina o layout pubblico, visibile prima dell'accesso o senza permessi riservati.
 * Moduli richiamati: `react`, `next-intl`, `next/navigation`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

'use client'

import { FormEvent, useState } from 'react'
import { Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

function AdminLoginForm() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/admin'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!response.ok) {
        setError(t('auth.admin.invalidCredentials'))
        return
      }

      const safeRedirect = redirectTo.startsWith('/admin') ? redirectTo : '/admin'
      router.push(safeRedirect)
      router.refresh()
    } catch {
      setError(t('common.error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-3xl shadow-ambient p-10">
        <div className="text-center mb-8">
          <span className="font-headline text-4xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-primary to-tertiary">
            Utraya
          </span>
          <p className="text-on-surface-variant mt-2 text-sm">
            {t('auth.admin.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-on-surface mb-1">
              {t('auth.admin.username')}
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/40 text-on-surface"
              placeholder={t('auth.admin.usernamePlaceholder')}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-on-surface mb-1">
              {t('auth.admin.password')}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/40 text-on-surface"
              placeholder={t('auth.admin.passwordPlaceholder')}
              required
            />
          </div>

          {error && (
            <div className="px-4 py-3 bg-error-container rounded-xl border border-error/10">
              <p className="text-sm text-error font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full gradient-primary text-on-primary px-6 py-4 rounded-full font-bold text-base
                     hover:shadow-primary-glow transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? t('auth.loggingIn') : t('auth.admin.loginButton')}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface flex items-center justify-center">
          <div className="skeleton w-96 h-64 rounded-3xl" />
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  )
}
