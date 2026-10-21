/* Commento didattico:
 * Scopo del file: editor admin riusabile per i retry delle credenziali private e del setting condiviso.
 * Moduli richiamati: React, next-intl e massimo tecnico del tipo intero PostgreSQL.
 * Flusso: ogni form invia un solo limite al route admin e mostra il massimo tentativi risultante.
 */

'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { AdminRetryLimitsViewModel } from '@/lib/services/retry-limits'
import { RETRY_LIMIT_MAX } from '@/lib/utils/retry-limit'

interface AdminRetryLimitsClientProps {
  initialRetryLimits: AdminRetryLimitsViewModel
}

type RetryLimitTarget =
  | { scope: 'credential'; credentialId: string }
  | { scope: 'shared-youtube' }

interface RetryLimitEditorProps {
  target: RetryLimitTarget
  initialLimit: number
  title: string
  identifier: string
  status?: string
  notice?: string
}

function RetryLimitEditor({ target, initialLimit, title, identifier, status, notice }: RetryLimitEditorProps) {
  const t = useTranslations('admin.retryLimits')
  const [limit, setLimit] = useState(String(initialLimit))
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputId = `retry-limit-${target.scope}-${'credentialId' in target ? target.credentialId : 'shared'}`
  const numericLimit = Number(limit)
  const validLimit = limit.trim() !== ''
    && Number.isSafeInteger(numericLimit)
    && numericLimit >= 0
    && numericLimit <= RETRY_LIMIT_MAX

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setError(null)
    if (!validLimit) {
      setError(t('invalid'))
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/admin/retry-limits', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...target, retryLimit: numericLimit }),
      })
      const payload = await response.json().catch(() => null) as {
        data?: { retryLimit?: number }
        error?: { message?: string }
      } | null
      if (!response.ok || typeof payload?.data?.retryLimit !== 'number') {
        throw new Error(payload?.error?.message ?? t('saveError'))
      }
      setLimit(String(payload.data.retryLimit))
      setFeedback(t('saved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl bg-surface-elevated p-5 shadow-soft sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="font-semibold text-on-surface">{title}</h3>
        <p className="break-all text-sm text-on-surface-variant">{identifier}</p>
        {status ? <p className="text-sm text-on-surface-variant">{status}</p> : null}
        {notice ? <p className="text-sm text-error">{notice}</p> : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={inputId} className="block text-sm font-medium text-on-surface">{t('retryLimit')}</label>
          <input
            id={inputId}
            type="number"
            min={0}
            max={RETRY_LIMIT_MAX}
            step={1}
            inputMode="numeric"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            aria-describedby={`${inputId}-attempts`}
            className="min-h-11 w-36 rounded-xl bg-surface-container px-3 text-base text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <p id={`${inputId}-attempts`} className="text-xs text-on-surface-variant">
            {t('maxAttempts', { count: validLimit ? numericLimit + 1 : '—' })}
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
      {feedback ? <p role="status" aria-live="polite" className="basis-full text-sm text-success">{feedback}</p> : null}
      {error ? <p role="alert" className="basis-full text-sm text-error">{error}</p> : null}
    </form>
  )
}

export default function AdminRetryLimitsClient({ initialRetryLimits }: AdminRetryLimitsClientProps) {
  const t = useTranslations('admin.retryLimits')

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-on-surface">{t('title')}</h1>
        <p className="max-w-3xl text-sm text-on-surface-variant">{t('subtitle')}</p>
      </header>

      <section aria-labelledby="private-retry-limits-title" className="space-y-4">
        <h2 id="private-retry-limits-title" className="text-lg font-semibold text-on-surface">{t('privateTitle')}</h2>
        {initialRetryLimits.credentials.length === 0
          ? <p className="rounded-2xl bg-surface-elevated p-5 text-sm text-on-surface-variant">{t('privateEmpty')}</p>
          : initialRetryLimits.credentials.map((credential) => (
            <RetryLimitEditor
              key={credential.credentialId}
              target={{ scope: 'credential', credentialId: credential.credentialId }}
              initialLimit={credential.retryLimit}
              title={`${credential.provider === 'youtube'
                ? t('youtubeDataApi')
                : credential.provider === 'gemini' ? t('gemini') : t('firecrawl')} — ${credential.owner}`}
              identifier={credential.credentialId}
              status={credential.isConfigured ? t('configured') : t('notConfigured')}
            />
          ))}
      </section>

      <section aria-labelledby="shared-retry-limits-title" className="space-y-4">
        <h2 id="shared-retry-limits-title" className="text-lg font-semibold text-on-surface">{t('sharedTitle')}</h2>
        <RetryLimitEditor
          target={{ scope: 'shared-youtube' }}
          initialLimit={initialRetryLimits.sharedYoutube.retryLimit}
          title={`${initialRetryLimits.sharedYoutube.service} — ${t('sharedKey')}`}
          identifier={initialRetryLimits.sharedYoutube.identifier}
          status={t('sharedInactive')}
          notice={t('sharedWarning')}
        />
      </section>
    </div>
  )
}
