/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `next`, `@/lib/supabase/admin`, `next-intl/server`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLocale, getTranslations } from 'next-intl/server'
import { buildJobLabel, collectJobChannelIds, collectJobUserIds } from '@/lib/utils/job-label'
import FailedJobsTableClient from './FailedJobsTableClient'
import LogCleanupButton from './LogCleanupButton'

export const metadata: Metadata = { title: 'Admin' }

export default async function AdminLogsPage() {
  const supabase = createAdminClient()
  const t = await getTranslations()
  const locale = await getLocale()

  const [{ data: appLogs }, { data: auditLogs }, { data: failedJobAttempts }, { data: failedJobs }] = await Promise.all([
    supabase
      .from('app_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('audit_logs')
      .select('*, users(email, display_name)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('job_attempts')
      .select('id, job_id, attempt_number, status, started_at, completed_at, error_message, error_details, jobs(id, job_type, status, payload, created_by_user_id)')
      .eq('status', 'failed')
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('jobs')
      .select('id, job_type, status, created_at, completed_at, error_message, payload, created_by_user_id')
      .eq('status', 'failed')
      .order('completed_at', { ascending: false })
      .limit(20),
  ])
  // Tipizzazione difensiva per query Supabase con join/shape eterogenee.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appLogRows = (appLogs ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auditLogRows = (auditLogs ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const failedAttemptRows = (failedJobAttempts ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const failedJobRows = (failedJobs ?? []) as any[]

  const failedJobLabelSources = failedJobRows.map((job) => ({
    id: job.id as string,
    created_by_user_id: (job.created_by_user_id as string | null | undefined) ?? null,
    payload: job.payload,
  }))
  const failedAttemptLabelSources = failedAttemptRows.map((attempt) => ({
    id: (attempt.jobs?.id ?? attempt.job_id) as string,
    created_by_user_id: (attempt.jobs?.created_by_user_id as string | null | undefined) ?? null,
    payload: attempt.jobs?.payload,
  }))

  const userIds = collectJobUserIds([...failedJobLabelSources, ...failedAttemptLabelSources])
  const channelIds = collectJobChannelIds([...failedJobLabelSources, ...failedAttemptLabelSources])

  const [usersResult, channelsResult] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string }> })
      : supabase.from('users').select('id, display_name, email').in('id', userIds),
    channelIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; title: string }> })
      : supabase.from('channels').select('id, title').in('id', channelIds),
  ])

  const usersById = Object.fromEntries((usersResult.data ?? []).map((u) => [u.id, u.display_name ?? u.email]))
  const channelsById = Object.fromEntries((channelsResult.data ?? []).map((c) => [c.id, c.title]))

  const failedRows =
    failedAttemptRows.length > 0
      ? failedAttemptRows.map((attempt) => {
        const source = {
          id: (attempt.jobs?.id ?? attempt.job_id) as string,
          created_by_user_id: (attempt.jobs?.created_by_user_id as string | null | undefined) ?? null,
          payload: attempt.jobs?.payload,
        }
        const detail = attempt.error_details
          ? (typeof attempt.error_details === 'string' ? attempt.error_details : JSON.stringify(attempt.error_details))
          : null
        return {
          id: attempt.id as string,
          label: buildJobLabel(source, usersById, channelsById),
          errorMessage: (attempt.error_message as string | null) ?? t('admin.logs.unknownError'),
          errorDetail: detail,
          timestampIso: (attempt.completed_at as string | null) ?? (attempt.started_at as string),
          attemptLabel: `#${attempt.attempt_number}`,
        }
      })
      : failedJobRows.map((job) => {
        const source = {
          id: job.id as string,
          created_by_user_id: (job.created_by_user_id as string | null | undefined) ?? null,
          payload: job.payload,
        }
        const detail = job.payload
          ? (typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload))
          : null
        return {
          id: job.id as string,
          label: buildJobLabel(source, usersById, channelsById),
          errorMessage: (job.error_message as string | null) ?? t('admin.logs.unknownError'),
          errorDetail: detail,
          timestampIso: (job.completed_at as string | null) ?? (job.created_at as string),
          attemptLabel: '—',
        }
      })

  const levelColor: Record<string, string> = {
    info: 'text-primary',
    warn: 'text-amber-500',
    error: 'text-error',
    debug: 'text-on-surface-variant',
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-10">
        <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface mb-1">
          {t('admin.logs.title')}
        </h1>
        <p className="text-on-surface-variant text-sm">{t('admin.logs.retention')}</p>
      </header>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 className="font-headline text-lg font-bold text-on-surface">{t('admin.logs.failedJobLogs')}</h2>
          <LogCleanupButton
            type="failed_jobs"
            label={t('admin.logs.cleanupFailedJobs')}
            confirmMessage={t('admin.logs.cleanupConfirmFailedJobs')}
            disabled={failedRows.length === 0}
          />
        </div>
        <FailedJobsTableClient rows={failedRows} emptyLabel={t('admin.logs.emptyFailedJobs')} locale={locale} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* App logs */}
        <div>
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="font-headline text-lg font-bold text-on-surface">{t('admin.logs.appLogs')}</h2>
            <LogCleanupButton
              type="app_logs"
              label={t('admin.logs.cleanupAppLogs')}
              confirmMessage={t('admin.logs.cleanupConfirmAppLogs')}
              disabled={appLogRows.length === 0}
            />
          </div>
          <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-ambient font-mono text-xs space-y-1 max-h-[600px] overflow-y-auto">
            {appLogRows.length === 0 ? (
              <p className="text-on-surface-variant text-center py-8">{t('admin.logs.empty')}</p>
            ) : (
              appLogRows.map((log) => (
                <div key={log.id} className="flex gap-2 py-1 border-b border-surface-container-high last:border-0">
                  <span className="text-outline shrink-0 w-14">
                    {new Date(log.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`w-12 shrink-0 font-bold uppercase ${levelColor[log.level] ?? ''}`}>
                    {log.level}
                  </span>
                  <span className="text-on-surface-variant leading-relaxed flex-1 line-clamp-2">
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Audit trail */}
        <div>
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="font-headline text-lg font-bold text-on-surface">{t('admin.logs.auditTrail')}</h2>
            <LogCleanupButton
              type="audit_logs"
              label={t('admin.logs.cleanupAuditLogs')}
              confirmMessage={t('admin.logs.cleanupConfirmAuditLogs')}
              disabled={auditLogRows.length === 0}
            />
          </div>
          <div className="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-ambient max-h-[600px] overflow-y-auto">
            {auditLogRows.length === 0 ? (
              <p className="text-on-surface-variant text-center py-8 px-4">{t('admin.logs.emptyAudit')}</p>
            ) : (
              auditLogRows.map((log, i) => (
                <div
                  key={log.id}
                  className={`px-5 py-3 border-b border-surface-container-high last:border-0
                               ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{log.action}</p>
                      <p className="text-xs text-on-surface-variant">
                        {log.users?.email ?? t('admin.logs.system')} · {log.resource_type}
                        {log.resource_id ? ` / ${log.resource_id.slice(0, 8)}…` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-outline shrink-0">
                      {new Date(log.created_at).toLocaleDateString(locale)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
