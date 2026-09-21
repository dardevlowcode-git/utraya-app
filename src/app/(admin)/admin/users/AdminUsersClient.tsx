/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `react`, `next/navigation`, `next-intl`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import MaskedField from '@/components/admin/MaskedField'
import { maskDisplayName, maskEmail } from '@/lib/utils/privacy-mask'

interface UserRow {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  status: 'active' | 'suspended' | 'deleted'
  created_at: string
  user_roles?: Array<{ roles?: { name?: string | null } | null }> | null
}

interface AllowlistRow {
  id: string
  email: string
  is_active: boolean
  added_at: string
}

interface AdminUsersClientProps {
  initialUsers: UserRow[]
  initialAllowlist: AllowlistRow[]
  schemaError?: string | null
}

type BusyState =
  | { type: 'authorize' }
  | { type: 'revoke'; email: string }
  | null

export default function AdminUsersClient({
  initialUsers,
  initialAllowlist,
  schemaError = null,
}: AdminUsersClientProps) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const [emailInput, setEmailInput] = useState('')
  const [busy, setBusy] = useState<BusyState>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Modalità presentazione: di default tutto mascherato, occhio solo per-riga.
  // Il valore reale resta in memoria/API: è protezione visiva da demo, non sicurezza del dato.
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  function isRevealed(key: string): boolean {
    return revealed[key] ?? false
  }

  function toggleRevealed(key: string) {
    setRevealed((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }))
  }

  const activeAllowlist = useMemo(
    () => initialAllowlist.filter((entry) => entry.is_active),
    [initialAllowlist]
  )

  function clearFeedback() {
    setMessage(null)
    setError(null)
  }

  async function handleAuthorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearFeedback()

    const email = emailInput.trim().toLowerCase()
    if (!email) {
      setError(t('admin.users.emailRequired'))
      return
    }

    setBusy({ type: 'authorize' })

    try {
      const response = await fetch('/api/admin/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { data: { message?: string } | null; error: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('admin.users.authorizeError'))
      }

      setMessage(payload?.data?.message ?? t('admin.users.authorized'))
      setEmailInput('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(null)
    }
  }

  async function handleRevoke(email: string) {
    clearFeedback()

    const confirmed = window.confirm(t('admin.users.revokeConfirm'))
    if (!confirmed) return

    setBusy({ type: 'revoke', email })

    try {
      const response = await fetch('/api/admin/allowlist', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { data: { message?: string } | null; error: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('admin.users.revokeError'))
      }

      setMessage(payload?.data?.message ?? t('admin.users.revoked'))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-10">
        <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface mb-1">
          {t('admin.users.title')}
        </h1>
        <p className="text-on-surface-variant text-sm">
          {t('admin.users.subtitle')}
        </p>
      </header>

      <div className="bg-surface-container-lowest rounded-2xl p-6 mb-8 shadow-ambient">
        <h2 className="font-headline text-base font-bold text-on-surface mb-1">
          {t('admin.users.allowlistUser')}
        </h2>
        <p className="text-sm text-on-surface-variant mb-4">
          {t('admin.users.allowlistDescription')}
        </p>

        <form className="flex gap-3" onSubmit={handleAuthorize}>
          <input
            type="email"
            placeholder={t('admin.users.emailPlaceholder')}
            className="input-field flex-1"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
            disabled={busy?.type === 'authorize' || Boolean(schemaError)}
          />
          <button
            type="submit"
            disabled={busy?.type === 'authorize' || Boolean(schemaError)}
            className="gradient-primary text-on-primary px-6 py-3 rounded-xl font-bold text-sm
                       hover:shadow-primary-glow transition-all active:scale-95 shrink-0
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy?.type === 'authorize' ? t('common.loading') : t('admin.users.authorizeAccess')}
          </button>
        </form>

        {schemaError && <p className="mt-3 text-sm text-error">{schemaError}</p>}
        {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
      </div>

      <section className="mb-8">
        <h2 className="font-headline text-xl font-bold text-on-surface mb-4">
          {t('admin.users.allowlistTitle')} ({activeAllowlist.length})
        </h2>

        {activeAllowlist.length === 0 ? (
          <div className="bg-surface-container-low rounded-2xl p-8 text-center text-on-surface-variant">
            {t('admin.users.allowlistEmpty')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="hidden overflow-hidden rounded-2xl bg-surface-container-lowest shadow-ambient md:block">
              <div className="grid grid-cols-12 gap-4 bg-surface-container-low px-6 py-3">
                <div className="col-span-6 text-label-caps text-on-surface-variant">{t('admin.users.email')}</div>
                <div className="col-span-3 text-label-caps text-on-surface-variant">{t('admin.users.registeredAt')}</div>
                <div className="col-span-3 text-label-caps text-on-surface-variant">{t('admin.users.actions')}</div>
              </div>

              {activeAllowlist.map((entry, index) => {
                const revokeBusy = busy?.type === 'revoke' && busy.email === entry.email
                return (
                  <div
                    key={entry.id}
                    className={`grid grid-cols-12 items-center gap-4 px-6 py-4 ${
                      index % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'
                    }`}
                  >
                    <div className="col-span-6 text-sm text-on-surface">
                      <MaskedField
                        value={entry.email}
                        maskedValue={maskEmail(entry.email)}
                        visible={isRevealed(`allowlist:${entry.id}`)}
                        onToggle={() => toggleRevealed(`allowlist:${entry.id}`)}
                        showLabel={t('admin.users.showEmail')}
                        hideLabel={t('admin.users.hideEmail')}
                      />
                    </div>
                    <div className="col-span-3 text-sm text-on-surface-variant">{new Date(entry.added_at).toLocaleDateString(locale)}</div>
                    <div className="col-span-3">
                      <button
                        type="button"
                        disabled={revokeBusy}
                        onClick={() => handleRevoke(entry.email)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/40 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {t('admin.users.revokeAccess')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="space-y-3 md:hidden">
              {activeAllowlist.map((entry) => {
                const revokeBusy = busy?.type === 'revoke' && busy.email === entry.email
                return (
                  <article key={entry.id} className="rounded-2xl border border-stroke-subtle bg-surface-statement p-4 shadow-soft">
                    <p className="text-label-caps text-on-surface-variant">{t('admin.users.email')}</p>
                    <p className="mt-1 text-sm font-medium text-on-surface">
                      <MaskedField
                        value={entry.email}
                        maskedValue={maskEmail(entry.email)}
                        visible={isRevealed(`allowlist:${entry.id}`)}
                        onToggle={() => toggleRevealed(`allowlist:${entry.id}`)}
                        showLabel={t('admin.users.showEmail')}
                        hideLabel={t('admin.users.hideEmail')}
                      />
                    </p>
                    <p className="mt-3 text-label-caps text-on-surface-variant">{t('admin.users.registeredAt')}</p>
                    <p className="mt-1 text-sm text-on-surface-variant">{new Date(entry.added_at).toLocaleDateString(locale)}</p>
                    <button
                      type="button"
                      disabled={revokeBusy}
                      onClick={() => handleRevoke(entry.email)}
                      className="mt-4 w-full rounded-full border border-error/40 px-3 py-2 text-xs font-semibold text-error disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('admin.users.revokeAccess')}
                    </button>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-headline text-xl font-bold text-on-surface mb-4">
          {t('admin.users.title')} ({initialUsers.length})
        </h2>
        <div className="space-y-3">
          <div className="hidden overflow-hidden rounded-2xl bg-surface-container-lowest shadow-ambient lg:block">
            <div className="grid grid-cols-12 gap-4 bg-surface-container-low px-6 py-3">
              <div className="col-span-4 text-label-caps text-on-surface-variant">{t('admin.users.user')}</div>
              <div className="col-span-3 text-label-caps text-on-surface-variant">{t('admin.users.role')}</div>
              <div className="col-span-2 text-label-caps text-on-surface-variant">{t('admin.users.status')}</div>
              <div className="col-span-2 text-label-caps text-on-surface-variant">{t('admin.users.registeredAt')}</div>
              <div className="col-span-1 text-label-caps text-on-surface-variant">{t('admin.users.actions')}</div>
            </div>

            {initialUsers.length === 0 ? (
              <div className="p-12 text-center text-on-surface-variant">{t('admin.users.empty')}</div>
            ) : (
              initialUsers.map((user, i) => {
                const role = user.user_roles?.[0]?.roles?.name ?? 'user'
                const isSuperAdmin = role === 'super_admin'

                return (
                  <div
                    key={user.id}
                    className={`grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-container ${
                      i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'
                    }`}
                  >
                    <div className="col-span-4 flex items-center gap-3">
                      {user.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full" />
                      ) : (
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${isSuperAdmin ? 'gradient-ai text-white' : 'gradient-primary text-on-primary'}`}>
                          {isRevealed(`user:${user.id}`)
                            ? (user.display_name ?? user.email)[0].toUpperCase()
                            : '•'}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-on-surface">
                          {user.display_name ? (
                            <MaskedField
                              value={user.display_name}
                              maskedValue={maskDisplayName(user.display_name)}
                              visible={isRevealed(`user:${user.id}`)}
                              onToggle={() => toggleRevealed(`user:${user.id}`)}
                              showLabel={t('admin.users.showEmail')}
                              hideLabel={t('admin.users.hideEmail')}
                            />
                          ) : (
                            t('common.unknown')
                          )}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          <MaskedField
                            value={user.email}
                            maskedValue={maskEmail(user.email)}
                            visible={isRevealed(`user:${user.id}`)}
                            onToggle={() => toggleRevealed(`user:${user.id}`)}
                            showLabel={t('admin.users.showEmail')}
                            hideLabel={t('admin.users.hideEmail')}
                          />
                        </p>
                      </div>
                    </div>

                    <div className="col-span-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isSuperAdmin ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-container text-on-surface-variant'}`}>
                        {isSuperAdmin ? t('admin.superAdmin') : t('admin.users.standardUser')}
                      </span>
                    </div>

                    <div className="col-span-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.status === 'active' ? 'bg-green-100 text-green-700' : user.status === 'suspended' ? 'bg-amber-100 text-amber-700' : 'bg-error-container text-error'}`}>
                        {user.status === 'active' ? t('admin.users.statusActive') : user.status === 'suspended' ? t('admin.users.statusSuspended') : t('admin.users.statusDeleted')}
                      </span>
                    </div>

                    <div className="col-span-2 text-sm text-on-surface-variant">{new Date(user.created_at).toLocaleDateString(locale)}</div>

                    <div className="col-span-1">
                      {!isSuperAdmin && (
                        <button
                          type="button"
                          title={t('admin.users.suspend')}
                          className="rounded-lg p-1.5 text-xs text-on-surface-variant transition-all hover:bg-amber-50 hover:text-amber-600"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {initialUsers.length === 0 ? (
            <div className="rounded-2xl bg-surface-container-low p-8 text-center text-on-surface-variant lg:hidden">
              {t('admin.users.empty')}
            </div>
          ) : (
            <div className="space-y-3 lg:hidden">
              {initialUsers.map((user) => {
                const role = user.user_roles?.[0]?.roles?.name ?? 'user'
                const isSuperAdmin = role === 'super_admin'
                return (
                  <article key={user.id} className="rounded-2xl border border-stroke-subtle bg-surface-statement p-4 shadow-soft">
                    <div className="flex items-center gap-3">
                      {user.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.avatar_url} alt="" className="h-9 w-9 rounded-full" />
                      ) : (
                        <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${isSuperAdmin ? 'gradient-ai text-white' : 'gradient-primary text-on-primary'}`}>
                          {isRevealed(`user:${user.id}`)
                            ? (user.display_name ?? user.email)[0].toUpperCase()
                            : '•'}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-on-surface">
                          {user.display_name ? (
                            <MaskedField
                              value={user.display_name}
                              maskedValue={maskDisplayName(user.display_name)}
                              visible={isRevealed(`user:${user.id}`)}
                              onToggle={() => toggleRevealed(`user:${user.id}`)}
                              showLabel={t('admin.users.showEmail')}
                              hideLabel={t('admin.users.hideEmail')}
                            />
                          ) : (
                            t('common.unknown')
                          )}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          <MaskedField
                            value={user.email}
                            maskedValue={maskEmail(user.email)}
                            visible={isRevealed(`user:${user.id}`)}
                            onToggle={() => toggleRevealed(`user:${user.id}`)}
                            showLabel={t('admin.users.showEmail')}
                            hideLabel={t('admin.users.hideEmail')}
                          />
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-label-caps text-on-surface-variant">{t('admin.users.role')}</p>
                        <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${isSuperAdmin ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-elevated text-on-surface-variant'}`}>
                          {isSuperAdmin ? t('admin.superAdmin') : t('admin.users.standardUser')}
                        </span>
                      </div>
                      <div>
                        <p className="text-label-caps text-on-surface-variant">{t('admin.users.status')}</p>
                        <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${user.status === 'active' ? 'bg-green-100 text-green-700' : user.status === 'suspended' ? 'bg-amber-100 text-amber-700' : 'bg-error-container text-error'}`}>
                          {user.status === 'active' ? t('admin.users.statusActive') : user.status === 'suspended' ? t('admin.users.statusSuspended') : t('admin.users.statusDeleted')}
                        </span>
                      </div>
                    </div>

                    <p className="mt-4 text-label-caps text-on-surface-variant">{t('admin.users.registeredAt')}</p>
                    <p className="mt-1 text-sm text-on-surface-variant">{new Date(user.created_at).toLocaleDateString(locale)}</p>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
