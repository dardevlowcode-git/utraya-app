/* Commento didattico:
 * Scopo del file: definisce una pagina o layout protetto: viene usato dopo l'autenticazione dell'utente.
 * Moduli richiamati: `react`, `@/lib/types/domain`, `next-intl`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

'use client'

import { useMemo, useState, type FormEvent } from 'react'
import type { CredentialStatus } from '@/lib/types/domain'
import { useTranslations } from 'next-intl'

type Provider = 'youtube' | 'gemini'

interface IntegrationsClientProps {
  initialStatuses: CredentialStatus[]
}

const CONNECTOR_META: Record<Provider, { title: string; description: string; iconBg: string }> = {
  youtube: {
    title: 'integrations.youtubeKey',
    description: 'integrations.youtubeKeyDesc',
    iconBg: 'bg-red-500',
  },
  gemini: {
    title: 'integrations.geminiKey',
    description: 'integrations.geminiKeyDesc',
    iconBg: 'gradient-ai',
  },
}

export default function IntegrationsClient({ initialStatuses }: IntegrationsClientProps) {
  const t = useTranslations()
  const [statuses, setStatuses] = useState<CredentialStatus[]>(initialStatuses)
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null)
  const [providerInput, setProviderInput] = useState<Record<Provider, string>>({ youtube: '', gemini: '' })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const configuredCount = useMemo(
    () => statuses.filter((status) => status.isConfigured).length,
    [statuses]
  )

  const byProvider = useMemo(() => {
    const map = new Map<Provider, CredentialStatus>()
    for (const status of statuses) {
      map.set(status.provider, status)
    }
    return map
  }, [statuses])

  function clearFeedback() {
    setMessage(null)
    setError(null)
  }

  async function refreshStatuses() {
    const response = await fetch('/api/integrations', { method: 'GET', cache: 'no-store' })
    const payload = (await response.json().catch(() => null)) as
      | { data: CredentialStatus[] | null; error: string | null }
      | null

    if (!response.ok || !payload?.data) {
      throw new Error(payload?.error ?? t('integrations.refreshError'))
    }

    setStatuses(payload.data)
  }

  async function handleSave(provider: Provider, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearFeedback()

    const apiKey = providerInput[provider].trim()
    if (!apiKey) {
      setError(t('integrations.keyRequired'))
      return
    }

    setBusyProvider(provider)

    try {
      const response = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, action: 'save' }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { data: { isValid: boolean | null; validationMessage: string | null } | null; error: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('integrations.saveError'))
      }

      setProviderInput((current) => ({ ...current, [provider]: '' }))

      if (payload?.data?.isValid === false && payload.data.validationMessage) {
        setError(`${t('integrations.savedButInvalid')}: ${payload.data.validationMessage}`)
      } else {
        setMessage(t('integrations.saved'))
      }

      await refreshStatuses()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusyProvider(null)
    }
  }

  async function handleValidate(provider: Provider) {
    clearFeedback()
    setBusyProvider(provider)

    try {
      const response = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, action: 'validate' }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { data: { isValid: boolean; message: string | null } | null; error: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('integrations.validateError'))
      }

      if (payload?.data?.isValid) {
        setMessage(t('integrations.validationSuccess'))
      } else {
        setError(payload?.data?.message ?? t('integrations.keyError'))
      }

      await refreshStatuses()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusyProvider(null)
    }
  }

  async function handleRemove(provider: Provider) {
    clearFeedback()

    const confirmed = window.confirm(t('integrations.removeConfirm'))
    if (!confirmed) return

    setBusyProvider(provider)

    try {
      const response = await fetch('/api/integrations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { data: { message?: string } | null; error: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('integrations.removeError'))
      }

      setMessage(payload?.data?.message ?? t('integrations.removed'))
      await refreshStatuses()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <header className="mb-10">
        <h1 className="font-headline text-4xl font-extrabold tracking-tight text-on-surface mb-2">
          {t('integrations.title')}
        </h1>
        <p className="text-on-surface-variant">
          {t('integrations.subtitle')}
        </p>
        <div className="mt-3 inline-flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${configuredCount === 2 ? 'status-active' : 'status-pending status-warning'}`} />
          <span className="text-on-surface-variant font-medium">
            {t('integrations.activeConnectors', { count: configuredCount })}
          </span>
        </div>
      </header>

      <div className="bg-primary-fixed/40 rounded-2xl p-5 mb-8 flex gap-4">
        <svg className="w-5 h-5 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
          />
        </svg>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          {t('integrations.serverEncrypted')}
        </p>
      </div>

      {message && <p className="mb-4 text-sm text-green-700">{message}</p>}
      {error && <p className="mb-4 text-sm text-error">{error}</p>}

      <div className="space-y-4">
        {(['youtube', 'gemini'] as Provider[]).map((provider) => {
          const connector = CONNECTOR_META[provider]
          const status = byProvider.get(provider)
          const isBusy = busyProvider === provider
          const isConfigured = status?.isConfigured ?? false
          const isValid = status?.isValid

          return (
            <div key={provider} className="bg-surface-container-lowest rounded-2xl p-6 shadow-ambient">
              <div className="flex items-start justify-between gap-6">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 ${connector.iconBg} rounded-xl flex items-center justify-center text-white shrink-0`}>
                    {provider === 'youtube' ? (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                        />
                      </svg>
                    )}
                  </div>

                  <div>
                    <h3 className="font-headline font-bold text-on-surface">{t(connector.title)}</h3>
                    <p className="text-sm text-on-surface-variant mb-3">{t(connector.description)}</p>

                    <div className="flex flex-wrap items-center gap-3 text-xs mb-2">
                      <span
                        className={`flex items-center gap-1.5 font-semibold px-3 py-1 rounded-full
                                  ${isConfigured
                                    ? isValid === false
                                      ? 'bg-error-container text-error'
                                      : 'bg-green-100 text-green-700'
                                    : 'bg-surface-container text-on-surface-variant'}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full
                                    ${isConfigured
                                      ? isValid === false ? 'bg-error' : 'bg-green-500'
                                      : 'bg-outline'}`}
                        />
                        {isConfigured
                          ? isValid === false ? t('integrations.status.invalid') : t('integrations.status.configured')
                          : t('integrations.status.notConfigured')}
                      </span>

                      {status?.maskedKey && (
                        <span className="text-on-surface-variant">Key: {status.maskedKey}</span>
                      )}

                      {status?.lastValidatedAt && (
                        <span className="text-on-surface-variant">
                          {t('integrations.lastCheck')} {new Date(status.lastValidatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {status?.lastError && (
                      <p className="text-xs text-error">{status.lastError}</p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 w-[340px]">
                  <form onSubmit={(event) => handleSave(provider, event)} className="flex items-center gap-2">
                    <input
                      type="password"
                      value={providerInput[provider]}
                      onChange={(event) =>
                        setProviderInput((current) => ({
                          ...current,
                          [provider]: event.target.value,
                        }))
                      }
                      placeholder={t('integrations.keyPlaceholder')}
                      className="flex-1 bg-surface-container-low rounded-xl px-3 py-2.5 text-sm text-on-surface
                                 placeholder:text-on-surface-variant outline-none"
                      disabled={isBusy}
                    />
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="gradient-primary text-on-primary px-4 py-2.5 rounded-xl font-bold text-sm
                                 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {t('integrations.saveKey')}
                    </button>
                  </form>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => handleValidate(provider)}
                      disabled={isBusy || !isConfigured}
                      className="flex items-center gap-1.5 text-sm font-semibold text-on-surface-variant
                                 hover:text-on-surface px-4 py-2 rounded-xl ghost-border transition-all
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('integrations.check')}
                    </button>
                    <button
                      onClick={() => handleRemove(provider)}
                      disabled={isBusy || !isConfigured}
                      className="flex items-center gap-1.5 text-sm font-semibold text-error
                                 hover:bg-error-container/30 px-4 py-2 rounded-xl transition-all
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('integrations.removeKey')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
