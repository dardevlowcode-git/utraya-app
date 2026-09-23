/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `react`, `next/navigation`, `next-intl`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useResizableColumns } from '@/components/admin/useResizableColumns'

interface JobRow {
  id: string
  job_type: string
  job_label?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  priority: number
  created_at: string
  error_message: string | null
  failure_detail?: string | null
}

interface TranscriptSettings {
  enabled: boolean
  batch_limit: number
}

interface TranscriptStats {
  pending: number
  fetched: number
  missing: number
  failed: number
  legacy_missing: number
  total: number
}

interface AdminJobsClientProps {
  initialJobs: JobRow[]
  upcomingSchedules: Array<{
    channelId: string
    channelTitle: string
    nextSyncAt: string
    lastSyncStatus: 'success' | 'failed' | 'partial' | null
  }>
  initialTranscriptSettings: TranscriptSettings
  initialTranscriptStats: TranscriptStats
}

type BusyState =
  | { jobId: string; action: 'delete' | 'retry' }
  | null

export default function AdminJobsClient({
  initialJobs,
  upcomingSchedules,
  initialTranscriptSettings,
  initialTranscriptStats,
}: AdminJobsClientProps) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const [jobs, setJobs] = useState<JobRow[]>(initialJobs)
  const [busy, setBusy] = useState<BusyState>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcriptsEnabled, setTranscriptsEnabled] = useState(initialTranscriptSettings.enabled)
  const [transcriptsBatchLimit, setTranscriptsBatchLimit] = useState(initialTranscriptSettings.batch_limit)
  const [transcriptStats, setTranscriptStats] = useState<TranscriptStats>(initialTranscriptStats)
  const [savingTranscripts, setSavingTranscripts] = useState(false)
  const [runningTranscripts, setRunningTranscripts] = useState(false)
  const { templateColumns, onStartResize } = useResizableColumns([420, 160, 110, 170, 360, 140], { minWidth: 90 })

  const statusColor: Record<JobRow['status'], string> = {
    pending: 'bg-amber-100 text-amber-700',
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-error-container text-error',
  }

  const statusLabel: Record<JobRow['status'], string> = {
    pending: t('admin.jobs.status.pending'),
    running: t('admin.jobs.status.running'),
    completed: t('admin.jobs.status.completed'),
    failed: t('admin.jobs.status.failed'),
  }

  function clearFeedback() {
    setMessage(null)
    setError(null)
  }

  async function handleDeletePendingJob(jobId: string) {
    clearFeedback()

    const confirmed = window.confirm(t('admin.jobs.deleteConfirm'))
    if (!confirmed) return

    setBusy({ jobId, action: 'delete' })

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as
        | { data: { message?: string } | null; error: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('admin.jobs.deleteError'))
      }

      setJobs((current) => current.filter((job) => job.id !== jobId))
      setMessage(payload?.data?.message ?? t('admin.jobs.deleted'))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(null)
    }
  }

  async function handleRetryFailedJob(jobId: string) {
    clearFeedback()

    const confirmed = window.confirm(t('admin.jobs.retryConfirm'))
    if (!confirmed) return

    setBusy({ jobId, action: 'retry' })

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as
        | { data: { message?: string; retriedJob?: JobRow } | null; error: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('admin.jobs.retryError'))
      }

      if (payload?.data?.retriedJob) {
        setJobs((current) => [payload.data!.retriedJob!, ...current].slice(0, 50))
      }

      setMessage(payload?.data?.message ?? t('admin.jobs.retried'))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setBusy(null)
    }
  }

  async function handleSaveTranscriptSettings() {
    clearFeedback()
    setSavingTranscripts(true)

    try {
      const response = await fetch('/api/admin/transcripts/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: transcriptsEnabled, batch_limit: transcriptsBatchLimit }),
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; data?: { settings?: TranscriptSettings; stats?: TranscriptStats }; error?: { message?: string } }
        | null

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? t('admin.jobs.transcripts.saveError'))
      }

      if (payload.data?.settings) {
        setTranscriptsEnabled(payload.data.settings.enabled)
        setTranscriptsBatchLimit(payload.data.settings.batch_limit)
      }
      if (payload.data?.stats) setTranscriptStats(payload.data.stats)
      setMessage(t('admin.jobs.transcripts.saved'))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setSavingTranscripts(false)
    }
  }

  async function handleRunTranscriptsNow() {
    clearFeedback()
    setRunningTranscripts(true)

    try {
      const response = await fetch('/api/admin/transcripts/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; data?: { checked?: number; fetched?: number; missing?: number; failed?: number } | null; error?: { message?: string } }
        | null

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? t('admin.jobs.transcripts.runError'))
      }

      const result = payload.data
      setMessage(
        t('admin.jobs.transcripts.runSuccess', {
          checked: result?.checked ?? 0,
          fetched: result?.fetched ?? 0,
          missing: result?.missing ?? 0,
          failed: result?.failed ?? 0,
        })
      )

      const statsResponse = await fetch('/api/admin/transcripts/settings', { cache: 'no-store' })
      const statsPayload = (await statsResponse.json().catch(() => null)) as
        | { ok: boolean; data?: { stats?: TranscriptStats } }
        | null
      if (statsResponse.ok && statsPayload?.ok && statsPayload.data?.stats) {
        setTranscriptStats(statsPayload.data.stats)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setRunningTranscripts(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-10">
        <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface mb-1">
          {t('admin.jobs.title')}
        </h1>
        <p className="text-on-surface-variant text-sm">
          {t('admin.jobs.subtitle')}
        </p>
      </header>

      {message && <p className="mb-4 text-sm text-green-700">{message}</p>}
      {error && <p className="mb-4 text-sm text-error">{error}</p>}

      <section className="mb-6 bg-surface-container-lowest rounded-2xl shadow-ambient p-5">
        <h2 className="text-lg font-semibold text-on-surface mb-1">
          {t('admin.jobs.transcripts.title')}
        </h2>
        <p className="text-sm text-on-surface-variant mb-4">
          {t('admin.jobs.transcripts.subtitle')}
        </p>

        <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4 text-sm text-on-surface-variant">
          <span>{t('admin.jobs.transcripts.statsPending')}: <strong className="text-on-surface">{transcriptStats.pending}</strong></span>
          <span>{t('admin.jobs.transcripts.statsFetched')}: <strong className="text-on-surface">{transcriptStats.fetched}</strong></span>
          <span>{t('admin.jobs.transcripts.statsMissing')}: <strong className="text-on-surface">{transcriptStats.missing}</strong></span>
          <span>{t('admin.jobs.transcripts.statsFailed')}: <strong className="text-on-surface">{transcriptStats.failed}</strong></span>
          <span>{t('admin.jobs.transcripts.statsLegacyMissing')}: <strong className="text-on-surface">{transcriptStats.legacy_missing}</strong></span>
          <span>{t('admin.jobs.transcripts.statsTotal')}: <strong className="text-on-surface">{transcriptStats.total}</strong></span>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={transcriptsEnabled}
              onChange={(event) => setTranscriptsEnabled(event.target.checked)}
              className="h-4 w-4"
            />
            {t('admin.jobs.transcripts.enabled')}
          </label>

          <label className="flex flex-col gap-1 text-sm text-on-surface">
            {t('admin.jobs.transcripts.batchLimit')}
            <input
              type="number"
              min={1}
              max={50}
              value={transcriptsBatchLimit}
              onChange={(event) => setTranscriptsBatchLimit(Number(event.target.value))}
              className="w-24 rounded-lg border border-outline/30 bg-surface-container-low px-2 py-1 text-sm"
            />
          </label>

          <button
            type="button"
            disabled={savingTranscripts}
            onClick={() => handleSaveTranscriptSettings()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-primary
                       hover:bg-primary-fixed transition-all
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t('admin.jobs.transcripts.save')}
          </button>

          <button
            type="button"
            disabled={runningTranscripts}
            onClick={() => handleRunTranscriptsNow()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-primary
                       hover:bg-primary-fixed transition-all
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t('admin.jobs.transcripts.runNow')}
          </button>
        </div>
      </section>

      <section className="mb-6 bg-surface-container-lowest rounded-2xl shadow-ambient p-5">
        <h2 className="text-lg font-semibold text-on-surface mb-1">
          {t('admin.jobs.scheduledTitle')}
        </h2>
        <p className="text-sm text-on-surface-variant mb-4">
          {t('admin.jobs.scheduledSubtitle')}
        </p>

        {upcomingSchedules.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            {t('admin.jobs.scheduledEmpty')}
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-on-surface-variant">
                  <th className="py-2 pr-4 font-medium">{t('admin.jobs.channel')}</th>
                  <th className="py-2 pr-4 font-medium">{t('admin.jobs.nextRun')}</th>
                  <th className="py-2 font-medium">{t('admin.jobs.lastSyncStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {upcomingSchedules.map((item) => (
                  <tr key={`${item.channelId}:${item.nextSyncAt}`} className="border-t border-outline/30">
                    <td className="py-2 pr-4 text-on-surface">{item.channelTitle}</td>
                    <td className="py-2 pr-4 text-on-surface-variant">
                      {new Date(item.nextSyncAt).toLocaleString(locale)}
                    </td>
                    <td className="py-2 text-on-surface-variant">
                      {item.lastSyncStatus ? t(`admin.jobs.syncStatus.${item.lastSyncStatus}`) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="bg-surface-container-lowest rounded-2xl shadow-ambient overflow-auto">
        <div className="min-w-max">
          <div className="grid px-6 py-3 bg-surface-container-low" style={{ gridTemplateColumns: templateColumns }}>
            {[
              t('admin.jobs.type'),
              t('admin.users.status'),
              t('admin.jobs.priority'),
              t('admin.jobs.createdAt'),
              t('admin.jobs.error'),
              t('admin.users.actions'),
            ].map((label, index, arr) => (
              <div key={label} className="relative pr-3">
                <div className={`text-label-caps text-on-surface-variant ${index === arr.length - 1 ? 'text-right' : ''}`}>
                  {label}
                </div>
                {index < arr.length - 1 && (
                  <button
                    type="button"
                    aria-label={`Resize ${label}`}
                    onMouseDown={(event) => onStartResize(index, event.clientX)}
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-primary/20"
                  />
                )}
              </div>
            ))}
          </div>

          {jobs.length === 0 ? (
            <div className="p-12 text-center text-on-surface-variant">
              {t('admin.jobs.empty')}
            </div>
          ) : (
            jobs.map((job, i) => {
              const deleteBusy = busy?.jobId === job.id && busy.action === 'delete'
              const retryBusy = busy?.jobId === job.id && busy.action === 'retry'
              return (
                <div
                  key={job.id}
                  className={`grid px-6 py-4 items-center
                           ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}
                           hover:bg-surface-container transition-colors`}
                  style={{ gridTemplateColumns: templateColumns }}
                >
                  <div className="pr-3">
                    <p className="text-sm font-mono font-semibold text-on-surface truncate">
                      {job.job_label ?? job.job_type}
                    </p>
                    {job.job_label && (
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">
                        {job.job_type}
                      </p>
                    )}
                  </div>
                  <div className="pr-3">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[job.status]}`}>
                      {statusLabel[job.status]}
                    </span>
                  </div>
                  <div className="text-sm text-on-surface-variant pr-3">{job.priority}</div>
                  <div className="text-sm text-on-surface-variant pr-3">
                    {new Date(job.created_at).toLocaleDateString(locale)}
                  </div>
                  <div className="pr-3">
                    <p className="text-xs text-error truncate">
                      {job.error_message ?? '—'}
                    </p>
                    {job.failure_detail ? (
                      <p className="text-[11px] text-on-surface-variant truncate mt-0.5" title={job.failure_detail}>
                        {job.failure_detail}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex justify-end">
                    {job.status === 'pending' && (
                      <button
                        type="button"
                        disabled={deleteBusy}
                        title={t('admin.jobs.delete')}
                        onClick={() => handleDeletePendingJob(job.id)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-error
                                 hover:bg-error-container/40 transition-all
                                 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {t('admin.jobs.delete')}
                      </button>
                    )}
                    {job.status === 'failed' && (
                      <button
                        type="button"
                        disabled={retryBusy}
                        title={t('admin.jobs.retry')}
                        onClick={() => handleRetryFailedJob(job.id)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-primary
                                 hover:bg-primary-fixed transition-all
                                 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {t('admin.jobs.retry')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
