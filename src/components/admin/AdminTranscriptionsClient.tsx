'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AdminTranscriptionFilter } from '@/lib/services/admin-transcriptions'
import type {
  AdminReviewWindowStats,
  AdminTranscriptionStatus,
  AdminTranscriptionViewModel,
} from '@/lib/view-models/admin-transcriptions'

export interface AdminTranscriptionsProps {
  filter: AdminTranscriptionFilter
  filters: readonly AdminTranscriptionFilter[]
  page: number
  pageCount: number
  total: number
  items: AdminTranscriptionViewModel[]
  stats: AdminReviewWindowStats[]
}

const STATUS_ORDER: AdminTranscriptionStatus[] = ['needs_review', 'pending', 'running', 'complete', 'unavailable']

function pageHref(filter: AdminTranscriptionFilter, page: number): string {
  const query = new URLSearchParams({ status: filter })
  if (page > 1) query.set('page', String(page))
  return `/admin/transcriptions?${query.toString()}`
}

function RelaunchButton({ transcriptionId, partPosition, label }: {
  transcriptionId: string
  partPosition: number | null
  label: string
}) {
  const t = useTranslations('admin.transcriptions')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  async function relaunch() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/transcriptions/${transcriptionId}/relaunch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(partPosition === null ? {} : { partPosition }),
      })
      const payload = await response.json().catch(() => null) as { data?: { partsReset?: number } } | null
      if (response.ok) setMessage({ text: t('relaunchDone', { count: payload?.data?.partsReset ?? 0 }), ok: true })
      else if (response.status === 409) setMessage({ text: t('relaunchBusy'), ok: false })
      else setMessage({ text: t('relaunchError'), ok: false })
    } catch {
      setMessage({ text: t('relaunchError'), ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={relaunch}
        disabled={busy}
        className="min-h-11 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60"
      >
        {busy ? t('relaunching') : label}
      </button>
      {message ? (
        <span role="status" aria-live="polite" className={message.ok ? 'text-sm text-success' : 'text-sm text-error'}>{message.text}</span>
      ) : null}
    </span>
  )
}

export default function AdminTranscriptionsClient({ filter, filters, page, pageCount, total, items, stats }: AdminTranscriptionsProps) {
  const t = useTranslations('admin.transcriptions')

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-on-surface">{t('title')}</h1>
        <p className="text-sm text-on-surface-variant">{t('subtitle')}</p>
      </header>

      <section aria-labelledby="tr-frequency" className="space-y-3 rounded-2xl bg-surface-elevated p-5 shadow-soft">
        <h2 id="tr-frequency" className="text-lg font-semibold text-on-surface">{t('frequencyTitle')}</h2>
        <p className="text-xs text-on-surface-variant">{t('frequencyNote')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {stats.map((window) => (
            <div key={window.days} data-testid={`tr-stats-${window.days}`} className="space-y-2 rounded-xl bg-surface-container p-4">
              <h3 className="text-sm font-semibold text-on-surface">{t('lastDays', { days: window.days })}</h3>
              <p className="text-base font-semibold text-on-surface">
                {window.needsReviewPercent === null
                  ? t('reviewPercentNone')
                  : t('reviewPercent', { value: window.needsReviewPercent })}
              </p>
              {window.averageDoubtfulPhrases !== null ? (
                <p className="text-sm text-on-surface-variant">{t('averageDoubtful', { value: window.averageDoubtfulPhrases })}</p>
              ) : null}
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-on-surface-variant">
                {STATUS_ORDER.map((status) => (
                  <li key={status}>{t(`status.${status}`)}: <span className="font-medium text-on-surface">{window.counts[status]}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
        {filters.map((value) => (
          <a
            key={value}
            href={pageHref(value, 1)}
            aria-current={value === filter ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${
              value === filter ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {value === 'all' ? t('filterAll') : t(`status.${value}`)}
          </a>
        ))}
      </nav>

      {items.length === 0 ? (
        <p role="status" className="rounded-2xl bg-surface-elevated p-4 text-sm text-on-surface-variant">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} data-testid="tr-item" className="space-y-3 rounded-2xl bg-surface-elevated p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <h3 className="break-words text-base font-semibold text-on-surface">{item.videoTitle}</h3>
                  {item.channelTitle ? <p className="text-sm text-on-surface-variant">{t('channel')}: {item.channelTitle}</p> : null}
                </div>
                <span className="rounded-full bg-surface-container px-3 py-1 text-xs font-semibold text-on-surface">{t(`status.${item.status}`)}</span>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                {item.appVideoHref ? <a href={item.appVideoHref} className="inline-flex min-h-11 items-center font-medium text-primary underline">{t('openVideo')}</a> : null}
                {item.youtubeUrl ? <a href={item.youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-primary underline">{t('openYoutube')}</a> : null}
              </div>

              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-on-surface-variant">{t('model')}: </dt><dd className="inline text-on-surface">{item.model}</dd></div>
                <div><dt className="inline text-on-surface-variant">{t('thinking')}: </dt><dd className="inline text-on-surface">{item.thinkingLevel}</dd></div>
                <div><dt className="inline text-on-surface-variant">{t('phrases')}: </dt><dd className="inline text-on-surface">{item.phraseCount}</dd></div>
                <div><dt className="inline text-on-surface-variant">{t('doubtful')}: </dt><dd className="inline text-on-surface">{item.doubtfulPhraseCount}</dd></div>
                <div><dt className="inline text-on-surface-variant">{t('date')}: </dt><dd className="inline text-on-surface"><time dateTime={item.referenceDate}>{item.referenceDate.slice(0, 16).replace('T', ' ')}</time></dd></div>
              </dl>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-on-surface">{t('missingParts')}</h4>
                {item.missingParts.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">{t('noMissingParts')}</p>
                ) : (
                  <ul className="space-y-2">
                    {item.missingParts.map((part) => (
                      <li key={part.position} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="font-mono text-on-surface">{part.interval}</span>
                        {part.lastError ? <span className="text-on-surface-variant">{t('lastError')}: <code>{part.lastError}</code></span> : null}
                        <RelaunchButton transcriptionId={item.id} partPosition={part.position} label={t('relaunchPart')} />
                      </li>
                    ))}
                  </ul>
                )}
                {item.canRelaunch ? <RelaunchButton transcriptionId={item.id} partPosition={null} label={t('relaunchAll')} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-on-surface-variant">
        <span>{t('page', { page, count: pageCount })} · {total}</span>
        <span className="flex gap-2">
          {page > 1 ? <a href={pageHref(filter, page - 1)} className="inline-flex min-h-11 items-center rounded-full bg-surface-container px-4">{t('previous')}</a> : null}
          {page < pageCount ? <a href={pageHref(filter, page + 1)} className="inline-flex min-h-11 items-center rounded-full bg-surface-container px-4">{t('next')}</a> : null}
          <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-full bg-surface-container px-4">{t('reload')}</button>
        </span>
      </footer>
    </div>
  )
}
