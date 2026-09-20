/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `next`, `@/lib/supabase/admin`, `./AdminJobsClient`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import AdminJobsClient from './AdminJobsClient'
import { buildJobLabel, collectJobChannelIds, collectJobUserIds } from '@/lib/utils/job-label'

export const metadata: Metadata = { title: 'Admin — Job' }

function computeNextIsoFromLast(lastSyncAt: string, frequencyHours: number): string {
  const base = new Date(lastSyncAt)
  const hours = Number.isFinite(frequencyHours) && frequencyHours > 0 ? frequencyHours : 24
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString()
}

export default async function AdminJobsPage() {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  const [jobsResult, upcomingResult, missingNextResult] = await Promise.all([
    supabase
      .from('jobs')
      .select('*, job_attempts(*)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('canonical_sync_state')
      .select(`
        channel_id,
        next_sync_at,
        last_sync_status,
        channels(id, title)
      `)
      .not('next_sync_at', 'is', null)
      .gte('next_sync_at', nowIso)
      .order('next_sync_at', { ascending: true })
      .limit(20),
    supabase
      .from('canonical_sync_state')
      .select(`
        channel_id,
        last_sync_at,
        next_sync_at,
        last_sync_status,
        channels(id, title)
      `)
      .is('next_sync_at', null)
      .not('last_sync_at', 'is', null)
      .order('last_sync_at', { ascending: false })
      .limit(200),
  ])

  // Tipizzazione difensiva: le query annidate possono essere inferite in modo troppo restrittivo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobRows = (jobsResult.data ?? []) as any[]

  const userIds = collectJobUserIds(jobRows)
  const channelIds = collectJobChannelIds(jobRows)

  const [usersResult, channelsResult] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string }> })
      : supabase
        .from('users')
        .select('id, display_name, email')
        .in('id', userIds),
    channelIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; title: string }> })
      : supabase
        .from('channels')
        .select('id, title')
        .in('id', channelIds),
  ])

  const usersById = Object.fromEntries(
    (usersResult.data ?? []).map((u) => [u.id, u.display_name ?? u.email])
  )
  const channelsById = Object.fromEntries(
    (channelsResult.data ?? []).map((c) => [c.id, c.title])
  )

  const jobsWithLabel = jobRows.map((job) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(() => {
      const attempts = (job.job_attempts ?? []) as any[]
      const latestAttempt = attempts
        .slice()
        .sort((a, b) => Number(b.attempt_number ?? 0) - Number(a.attempt_number ?? 0))[0]
      const details = latestAttempt?.error_details
      const failureDetail = details
        ? (typeof details === 'string' ? details : JSON.stringify(details))
        : null
      return { failure_detail: failureDetail }
    })(),
    ...job,
    job_label: buildJobLabel(job, usersById, channelsById),
  }))

  const upcomingRows = (upcomingResult.data ?? []) as Array<{
    channel_id: string
    next_sync_at: string
    last_sync_status: 'success' | 'failed' | 'partial' | null
    channels?: { id: string; title: string } | Array<{ id: string; title: string }> | null
  }>

  const missingNextRows = (missingNextResult.data ?? []) as Array<{
    channel_id: string
    last_sync_at: string
    last_sync_status: 'success' | 'failed' | 'partial' | null
    channels?: { id: string; title: string } | Array<{ id: string; title: string }> | null
  }>

  const fallbackChannelIds = Array.from(new Set(missingNextRows.map((row) => row.channel_id)))
  const userChannelsResult = fallbackChannelIds.length === 0
    ? { data: [] as Array<{ id: string; channel_id: string }> }
    : await supabase
      .from('user_channels')
      .select('id, channel_id')
      .in('channel_id', fallbackChannelIds)
      .eq('is_active', true)

  const userChannelIds = (userChannelsResult.data ?? []).map((row) => row.id)
  const preferencesResult = userChannelIds.length === 0
    ? { data: [] as Array<{ user_channel_id: string; sync_frequency_hours: number; is_paused: boolean }> }
    : await supabase
      .from('user_channel_preferences')
      .select('user_channel_id, sync_frequency_hours, is_paused')
      .in('user_channel_id', userChannelIds)

  const channelByUserChannelId = new Map<string, string>()
  for (const row of userChannelsResult.data ?? []) {
    channelByUserChannelId.set(row.id, row.channel_id)
  }

  const minFrequencyByChannelId = new Map<string, number>()
  for (const pref of preferencesResult.data ?? []) {
    if (pref.is_paused) continue
    const channelId = channelByUserChannelId.get(pref.user_channel_id)
    if (!channelId) continue
    const current = minFrequencyByChannelId.get(channelId)
    if (current === undefined || pref.sync_frequency_hours < current) {
      minFrequencyByChannelId.set(channelId, pref.sync_frequency_hours)
    }
  }

  const upcomingFromState = upcomingRows
    .map((row) => {
      const channel = Array.isArray(row.channels) ? row.channels[0] : row.channels
      if (!channel?.id || !row.next_sync_at) return null
      return {
        channelId: channel.id,
        channelTitle: channel.title,
        nextSyncAt: row.next_sync_at,
        lastSyncStatus: row.last_sync_status ?? null,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const fallbackUpcoming = missingNextRows
    .map((row) => {
      const channel = Array.isArray(row.channels) ? row.channels[0] : row.channels
      if (!channel?.id || !row.last_sync_at) return null

      const frequencyHours = minFrequencyByChannelId.get(channel.id) ?? 24
      const estimatedNextSyncAt = computeNextIsoFromLast(row.last_sync_at, frequencyHours)
      if (estimatedNextSyncAt < nowIso) return null

      return {
        channelId: channel.id,
        channelTitle: channel.title,
        nextSyncAt: estimatedNextSyncAt,
        lastSyncStatus: row.last_sync_status ?? null,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const mergedByChannel = new Map<string, (typeof upcomingFromState)[number]>()
  for (const row of upcomingFromState) {
    mergedByChannel.set(row.channelId, row)
  }
  for (const row of fallbackUpcoming) {
    if (!mergedByChannel.has(row.channelId)) {
      mergedByChannel.set(row.channelId, row)
    }
  }

  const upcomingSchedules = Array.from(mergedByChannel.values())
    .sort((a, b) => a.nextSyncAt.localeCompare(b.nextSyncAt))
    .slice(0, 20)

  return <AdminJobsClient initialJobs={jobsWithLabel} upcomingSchedules={upcomingSchedules} />
}
