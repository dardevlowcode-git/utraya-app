/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `next`, `@/lib/supabase/admin`, `next-intl/server`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/types/database'
import { getLocale, getTranslations } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'Admin',
}

export default async function AdminHomePage() {
  const supabase = createAdminClient()
  const t = await getTranslations()
  const locale = await getLocale()
  type AppLogRow = Database['public']['Tables']['app_logs']['Row']
  type IncidentRow = Database['public']['Tables']['incidents']['Row']

  const [
    { count: totalUsers },
    { count: totalChannels },
    { count: totalVideos },
    { count: pendingJobs },
    { count: failedJobs },
    { data: recentLogsData },
    { data: recentIncidentsData },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('channels').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('videos').select('*', { count: 'exact', head: true }),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    supabase
      .from('app_logs')
      .select('id, level, message, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('incidents')
      .select('id, severity, title, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(5),
  ])
  const recentLogs: AppLogRow[] = (recentLogsData ?? []) as AppLogRow[]
  const recentIncidents: IncidentRow[] = (recentIncidentsData ?? []) as IncidentRow[]

  const statCards = [
    { label: t('admin.metrics.activeUsers'), value: totalUsers ?? 0, icon: '👤', color: 'bg-primary-fixed' },
    { label: t('admin.metrics.activeChannels'), value: totalChannels ?? 0, icon: '📺', color: 'bg-secondary-fixed' },
    { label: t('admin.metrics.totalVideos'), value: totalVideos ?? 0, icon: '🎬', color: 'bg-surface-container-high' },
    { label: t('admin.metrics.pendingJobs'), value: pendingJobs ?? 0, icon: '⏳', color: 'bg-amber-100' },
    { label: t('admin.metrics.failedJobs'), value: failedJobs ?? 0, icon: '❌', color: 'bg-error-container' },
  ]

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 gradient-ai rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
            </svg>
          </div>
          <div>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">
              {t('admin.systemHealth')}
            </h1>
            <p className="text-on-surface-variant text-sm">
              {t('admin.systemHealthSubtitle')}
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
        {statCards.map((card) => (
          <div key={card.label} className={`${card.color} rounded-2xl p-5`}>
            <p className="text-2xl mb-2">{card.icon}</p>
            <p className="font-headline text-3xl font-extrabold text-on-surface">{card.value}</p>
            <p className="text-xs text-on-surface-variant font-medium mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-ambient">
          <h2 className="font-headline text-lg font-bold text-on-surface mb-4">
            {t('admin.incidents.openIncidents')}
          </h2>
          {!recentIncidents || recentIncidents.length === 0 ? (
            <div className="flex items-center gap-3 py-4">
              <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-on-surface text-sm">{t('admin.incidents.none')}</p>
                <p className="text-xs text-on-surface-variant">{t('admin.incidents.systemOperational')}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {recentIncidents.map((incident) => (
                <div key={incident.id} className="flex items-start gap-3 p-3 bg-error-container/30 rounded-xl">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0
                    ${incident.severity === 'critical' || incident.severity === 'high' ? 'bg-error' : 'bg-amber-400'}`} />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{incident.title}</p>
                    <p className="text-xs text-on-surface-variant capitalize">{incident.severity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-ambient">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-headline text-lg font-bold text-on-surface">{t('admin.logs.title')}</h2>
            <a href="/admin/logs" className="text-xs text-primary hover:underline">{t('admin.logs.viewAll')}</a>
          </div>
          <div className="space-y-1 font-mono text-xs">
            {!recentLogs || recentLogs.length === 0 ? (
              <p className="text-on-surface-variant py-4 text-center">{t('admin.logs.empty')}</p>
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 py-1.5 border-b border-surface-container-high last:border-0">
                  <span className={`w-12 shrink-0 font-bold text-xs uppercase
                    ${log.level === 'error' ? 'text-error' :
                      log.level === 'warn' ? 'text-amber-500' :
                      log.level === 'info' ? 'text-primary' : 'text-on-surface-variant'}`}>
                    {log.level}
                  </span>
                  <span className="text-on-surface-variant text-xs leading-relaxed line-clamp-1 flex-1">
                    {log.message}
                  </span>
                  <span className="text-outline text-xs shrink-0">
                    {new Date(log.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
