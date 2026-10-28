'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { ThinkingLevel } from '@/lib/services/transcription'

export interface AdminTranscriptionProfileProps {
  profile: { model: string; thinkingLevel: ThinkingLevel; inputPricePerMillion: number; outputPricePerMillion: number }
  models: { status: 'ok'; models: string[] } | { status: 'no_key' } | { status: 'error' }
  pricingUrl: string
}

const LEVELS: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']
const LEVEL_KEYS = { minimal: 'levelMinimal', low: 'levelLow', medium: 'levelMedium', high: 'levelHigh' } as const

function validPrice(value: string): boolean {
  if (value.trim() === '') return false
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 999_999.999999) return false
  return /^\d+(\.\d{1,6})?$/.test(value.trim())
}

export default function AdminTranscriptionProfileClient({ profile, models, pricingUrl }: AdminTranscriptionProfileProps) {
  const t = useTranslations('admin.aiProfile')
  const [model, setModel] = useState(profile.model)
  const [level, setLevel] = useState<ThinkingLevel>(profile.thinkingLevel)
  const [inputPrice, setInputPrice] = useState(String(profile.inputPricePerMillion))
  const [outputPrice, setOutputPrice] = useState(String(profile.outputPricePerMillion))
  const [savedModel, setSavedModel] = useState(profile.model)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const options = models.status === 'ok'
    ? Array.from(new Set([savedModel, ...models.models]))
    : [savedModel]
  const modelChanged = model !== savedModel

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setError(null)
    if (!validPrice(inputPrice) || !validPrice(outputPrice)) {
      setError(t('invalidPrice'))
      return
    }
    setSaving(true)
    try {
      const response = await fetch('/api/admin/transcription-profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          thinkingLevel: level,
          inputPricePerMillion: Number(inputPrice),
          outputPricePerMillion: Number(outputPrice),
        }),
      })
      const payload = await response.json().catch(() => null) as {
        data?: AdminTranscriptionProfileProps['profile']
        error?: { message?: string }
      } | null
      if (!response.ok || !payload?.data) throw new Error(payload?.error?.message ?? t('saveError'))
      setSavedModel(payload.data.model)
      setModel(payload.data.model)
      setLevel(payload.data.thinkingLevel)
      setInputPrice(String(payload.data.inputPricePerMillion))
      setOutputPrice(String(payload.data.outputPricePerMillion))
      setFeedback(t('saved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = 'min-h-11 w-full rounded-xl bg-surface-container px-3 text-base text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-primary'

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-on-surface">{t('title')}</h1>
        <p className="text-sm text-on-surface-variant">{t('subtitle')}</p>
      </header>

      {models.status === 'no_key' ? <p role="status" className="rounded-2xl bg-surface-elevated p-4 text-sm text-error">{t('noKey')}</p> : null}
      {models.status === 'error' ? <p role="status" className="rounded-2xl bg-surface-elevated p-4 text-sm text-error">{t('listError')}</p> : null}

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-surface-elevated p-5 shadow-soft">
        <div className="space-y-1">
          <label htmlFor="tp-model" className="block text-sm font-medium text-on-surface">
            {models.status === 'ok' ? t('model') : t('currentModel')}
          </label>
          <select
            id="tp-model"
            value={model}
            disabled={models.status !== 'ok'}
            onChange={(event) => setModel(event.target.value)}
            className={fieldClass}
          >
            {options.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          {models.status === 'ok' ? <p className="text-xs text-on-surface-variant">{t('modelsRefreshNote')}</p> : null}
        </div>

        <div className="space-y-1">
          <label htmlFor="tp-level" className="block text-sm font-medium text-on-surface">{t('thinkingLevel')}</label>
          <select id="tp-level" value={level} onChange={(event) => setLevel(event.target.value as ThinkingLevel)} className={fieldClass}>
            {LEVELS.map((value) => <option key={value} value={value}>{t(LEVEL_KEYS[value])}</option>)}
          </select>
          {model.startsWith('gemini-2.5') ? <p className="text-xs text-on-surface-variant">{t('levelBudgetNote')}</p> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="tp-input-price" className="block text-sm font-medium text-on-surface">{t('inputPrice')}</label>
            <input id="tp-input-price" type="number" min={0} step="0.000001" inputMode="decimal" value={inputPrice}
              onChange={(event) => setInputPrice(event.target.value)} className={fieldClass} />
          </div>
          <div className="space-y-1">
            <label htmlFor="tp-output-price" className="block text-sm font-medium text-on-surface">{t('outputPrice')}</label>
            <input id="tp-output-price" type="number" min={0} step="0.000001" inputMode="decimal" value={outputPrice}
              onChange={(event) => setOutputPrice(event.target.value)} className={fieldClass} />
          </div>
        </div>
        <p className="text-xs text-on-surface-variant">{t('priceHint')}</p>

        {modelChanged ? (
          <p role="status" className="text-sm text-on-surface">
            {t('priceReminder')}{' '}
            <a href={pricingUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">{t('pricingLink')}</a>
          </p>
        ) : (
          <p className="text-xs text-on-surface-variant">
            <a href={pricingUrl} target="_blank" rel="noopener noreferrer" className="underline">{t('pricingLink')}</a>
          </p>
        )}

        <p className="text-xs text-on-surface-variant">{t('effectNote')}</p>

        <button type="submit" disabled={saving} className="min-h-11 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">
          {saving ? t('saving') : t('save')}
        </button>
        {feedback ? <p role="status" aria-live="polite" className="text-sm text-success">{feedback}</p> : null}
        {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
      </form>
    </div>
  )
}
