/* Commento didattico:
 * Scopo del file: carica dati tracker lato server, applica filtro canale/view via URL e delega rendering interattivo al client.
 * Moduli richiamati: `next`, `next-intl/server`, `next/navigation`, servizi auth/channels/videos
 * Flusso: valida sessione, risolve filtro canale, carica tutti i video utili al tracker e passa stato iniziale a `TrackerClient`.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import TrackerClient from './TrackerClient'
import { getCurrentSession } from '@/lib/auth/provider'
import { getChannelsForUser } from '@/lib/services/channels'
import { getVideosForUser } from '@/lib/services/videos'
import type { VideoWithContext } from '@/lib/types/domain'

export const metadata: Metadata = {
  title: 'Tracker Video',
}

type TrackerViewMode = 'ribbon' | 'list' | 'latest'

interface TrackerPageProps {
  searchParams?: Promise<{
    view?: string | string[]
    channelId?: string | string[]
  }>
}

function firstParam(value?: string | string[]): string | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function normalizeView(value: string | null): TrackerViewMode {
  if (value === 'list' || value === 'latest') return value
  return 'ribbon'
}

async function loadTrackerVideos(params: {
  userId: string
  languageCode: string
  channelId?: string
}): Promise<VideoWithContext[]> {
  const limit = 50
  let page = 1
  let total = Number.POSITIVE_INFINITY
  const allItems: VideoWithContext[] = []

  while (allItems.length < total) {
    const response = await getVideosForUser({
      userId: params.userId,
      languageCode: params.languageCode,
      channelId: params.channelId,
      limit,
      page,
    })

    allItems.push(...response.items)
    total = response.total
    if (response.items.length === 0) break
    page += 1
  }

  return allItems
}

export default async function TrackerPage({ searchParams }: TrackerPageProps) {
  const session = await getCurrentSession()
  if (!session) {
    redirect('/login')
  }

  const [t, locale, userChannels, resolvedSearchParams] = await Promise.all([
    getTranslations(),
    getLocale(),
    getChannelsForUser(session.userId),
    searchParams,
  ])

  const queryView = firstParam(resolvedSearchParams?.view)
  const queryChannelId = firstParam(resolvedSearchParams?.channelId)
  const initialView = normalizeView(queryView)

  const activeChannels = userChannels.map((item) => item.channel)
  const allowedChannelIds = new Set(activeChannels.map((channel) => channel.id))
  const selectedChannelId = queryChannelId && allowedChannelIds.has(queryChannelId) ? queryChannelId : null
  const selectedChannel = selectedChannelId
    ? activeChannels.find((channel) => channel.id === selectedChannelId) ?? null
    : null

  const items = await loadTrackerVideos({
    userId: session.userId,
    languageCode: session.preferredLanguage,
    channelId: selectedChannelId ?? undefined,
  })

  return (
    <TrackerClient
      items={items}
      locale={locale}
      initialView={initialView}
      selectedChannelId={selectedChannelId}
      channels={activeChannels.map((channel) => ({ id: channel.id, title: channel.title }))}
      labels={{
        title: t('tracker.title'),
        subtitle: t('tracker.subtitle'),
        empty: t('tracker.empty'),
        addChannels: t('tracker.addChannels'),
        allCaughtUp: t('tracker.allCaughtUp'),
        noneWatchedYet: t('tracker.noneWatchedYet'),
        noVideosForFilters: t('tracker.noVideosForFilters'),
        viewSummary: t('tracker.viewSummary'),
        scope: {
          allChannels: t('tracker.scope.allChannels'),
          selectedChannelPrefix: t('tracker.scope.selectedChannelPrefix'),
          selectedChannelFallback: selectedChannel?.title ?? queryChannelId ?? t('tracker.scope.allChannels'),
        },
        badges: {
          unseen: t('tracker.badges.unseen'),
          seen: t('tracker.badges.seen'),
          hidden: t('tracker.badges.hidden'),
          watchlist: t('tracker.badges.watchlist'),
        },
        filters: {
          menu: t('tracker.filters.menu'),
          state: t('tracker.filters.state'),
          seen: t('tracker.filters.seen'),
          unseen: t('tracker.filters.unseen'),
          hidden: t('tracker.filters.hidden'),
          duration: t('tracker.filters.duration'),
          durationUnder2m: t('tracker.filters.durationUnder2m'),
          durationUnder5m: t('tracker.filters.durationUnder5m'),
          durationBetween2m30m: t('tracker.filters.durationBetween2m30m'),
          durationOver30m: t('tracker.filters.durationOver30m'),
        },
        views: {
          ribbon: t('tracker.views.ribbon'),
          list: t('tracker.views.list'),
          latest: t('tracker.views.latest'),
        },
        latest: {
          emptyChannel: t('tracker.latest.emptyChannel'),
        },
        list: {
          headers: {
            video: t('tracker.list.headers.video'),
            channel: t('tracker.list.headers.channel'),
            actions: t('tracker.list.headers.actions'),
            generalCategory: t('tracker.list.headers.generalCategory'),
            subcategory: t('tracker.list.headers.subcategory'),
            shortSummary: t('tracker.list.headers.shortSummary'),
          },
          noData: t('tracker.list.noData'),
        },
        duration: {
          unknown: t('tracker.duration.unknown'),
          under2m: t('tracker.duration.under2m'),
          between2m30m: t('tracker.duration.between2m30m'),
          over30m: t('tracker.duration.over30m'),
        },
        statusInfo: {
          seenWithDate: t('tracker.statusInfo.seenWithDate'),
          hiddenWithDate: t('tracker.statusInfo.hiddenWithDate'),
        },
        metrics: {
          toWatch: t('tracker.metrics.toWatch'),
          watched: t('tracker.metrics.watched'),
          hidden: t('tracker.metrics.hidden'),
        },
        actions: {
          markSeen: t('dashboard.markSeen'),
          markUnseen: t('dashboard.markUnseen'),
          hide: t('tracker.actions.hide'),
          unhide: t('tracker.actions.unhide'),
        },
        error: t('common.error'),
      }}
    />
  )
}
