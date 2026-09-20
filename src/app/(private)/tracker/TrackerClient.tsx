/* Commento didattico:
 * Scopo del file: renderizza il tracker lato client con filtri stato, selezione vista e supporto filtro canale.
 * Moduli richiamati: `next/link`, `next/navigation`, `react`, `./SeenStatusButton`, `@/lib/types/domain`
 * Flusso: mantiene stato locale video/filtri/vista, aggiorna query URL e proietta i dati nelle viste ribbon/list/latest.
 */

'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import SeenStatusButton from './SeenStatusButton'
import type { VideoWithContext } from '@/lib/types/domain'
import { formatVideoDuration, getVideoDurationBucket } from '@/lib/utils/video-duration'
import { matchesTrackerFilters, type DurationFilterState, type SeenFilterState, type SeenStatus } from './tracker-filters'

type TrackerViewMode = 'ribbon' | 'list' | 'latest'
type DurationFilterKey = keyof DurationFilterState

interface TrackerClientProps {
  items: VideoWithContext[]
  locale: string
  initialView: TrackerViewMode
  selectedChannelId: string | null
  channels: Array<{ id: string; title: string }>
  labels: {
    title: string
    subtitle: string
    empty: string
    addChannels: string
    allCaughtUp: string
    noneWatchedYet: string
    noVideosForFilters: string
    viewSummary: string
    scope: {
      allChannels: string
      selectedChannelPrefix: string
      selectedChannelFallback: string
    }
    badges: {
      unseen: string
      seen: string
      hidden: string
      watchlist: string
    }
    filters: {
      menu: string
      state: string
      seen: string
      unseen: string
      hidden: string
      duration: string
      durationUnder2m: string
      durationUnder5m: string
      durationBetween2m30m: string
      durationOver30m: string
    }
    views: {
      ribbon: string
      list: string
      latest: string
    }
    latest: {
      emptyChannel: string
    }
    list: {
      headers: {
        video: string
        channel: string
        actions: string
        generalCategory: string
        subcategory: string
        shortSummary: string
      }
      noData: string
    }
    duration: {
      unknown: string
      under2m: string
      between2m30m: string
      over30m: string
    }
    statusInfo: {
      seenWithDate: string
      hiddenWithDate: string
    }
    metrics: {
      toWatch: string
      watched: string
      hidden: string
    }
    actions: {
      markSeen: string
      markUnseen: string
      hide: string
      unhide: string
    }
    error: string
  }
}

type LatestRow = {
  channelId: string
  channelTitle: string
  item: VideoWithContext | null
}

export default function TrackerClient({
  items,
  locale,
  initialView,
  selectedChannelId,
  channels,
  labels,
}: TrackerClientProps) {
  const [videos, setVideos] = useState(items)
  const [view, setView] = useState<TrackerViewMode>(initialView)
  const [seenFilters, setSeenFilters] = useState<SeenFilterState>({
    seen: false,
    unseen: true,
    hidden: false,
  })
  const [durationFilters, setDurationFilters] = useState<DurationFilterState>({
    under2m: true,
    under5m: true,
    between2m30m: true,
    over30m: true,
  })
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const counts = useMemo(() => {
    return {
      unseen: videos.filter((item) => item.userState.seenStatus === 'unseen').length,
      seen: videos.filter((item) => item.userState.seenStatus === 'seen').length,
      hidden: videos.filter((item) => item.userState.seenStatus === 'hidden').length,
    }
  }, [videos])

  const filteredItems = useMemo(() => {
    return videos.filter((item) => matchesTrackerFilters({
      seenStatus: item.userState.seenStatus,
      durationSeconds: item.video.duration_seconds,
      seenFilters,
      durationFilters,
    }))
  }, [durationFilters, seenFilters, videos])

  const channelScopeLabel = selectedChannelId
    ? `${labels.scope.selectedChannelPrefix}: ${labels.scope.selectedChannelFallback}`
    : labels.scope.allChannels

  const latestRows = useMemo(() => {
    if (view !== 'latest') return []
    return buildLatestRows(filteredItems, channels, selectedChannelId, locale)
  }, [channels, filteredItems, locale, selectedChannelId, view])

  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (seenFilters.unseen) count += 1
    if (seenFilters.seen) count += 1
    if (seenFilters.hidden) count += 1
    if (durationFilters.under2m) count += 1
    if (durationFilters.under5m) count += 1
    if (durationFilters.between2m30m) count += 1
    if (durationFilters.over30m) count += 1
    return count
  }, [durationFilters, seenFilters])

  function updateView(nextView: TrackerViewMode) {
    setView(nextView)

    const params = new URLSearchParams(searchParams.toString())
    params.set('view', nextView)

    if (selectedChannelId) {
      params.set('channelId', selectedChannelId)
    } else {
      params.delete('channelId')
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function toggleSeenFilter(filterKey: SeenStatus) {
    setSeenFilters((current) => ({ ...current, [filterKey]: !current[filterKey] }))
  }

  function toggleDurationFilter(filterKey: DurationFilterKey) {
    setDurationFilters((current) => ({ ...current, [filterKey]: !current[filterKey] }))
  }

  function updateVideoStatus(videoId: string, nextState: { seenStatus: SeenStatus; seenAt: string | null; hiddenAt: string | null }) {
    setVideos((current) =>
      current.map((item) => {
        if (item.video.id !== videoId) return item
        return {
          ...item,
          userState: {
            ...item.userState,
            seenStatus: nextState.seenStatus,
            seenAt: nextState.seenAt,
            hiddenAt: nextState.hiddenAt,
          },
        }
      })
    )
  }

  return (
    <div className="p-8 max-w-[1400px]">
      <header className="mb-8">
        <h1 className="font-headline text-4xl font-extrabold tracking-tight text-on-surface mb-2">
          {labels.title}
        </h1>
        <p className="text-on-surface-variant text-lg mb-2">
          {labels.subtitle}
        </p>
        <p className="text-sm font-semibold text-primary mb-5">
          {channelScopeLabel}
        </p>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <MetricCard label={labels.metrics.toWatch} value={counts.unseen} tone="primary" />
          <MetricCard label={labels.metrics.watched} value={counts.seen} tone="neutral" />
          <MetricCard label={labels.metrics.hidden} value={counts.hidden} tone="danger" />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterMenu
            isOpen={isFilterMenuOpen}
            activeFiltersCount={activeFiltersCount}
            labels={labels.filters}
            seenFilters={seenFilters}
            durationFilters={durationFilters}
            onToggleMenu={() => setIsFilterMenuOpen((current) => !current)}
            onToggleSeenFilter={toggleSeenFilter}
            onToggleDurationFilter={toggleDurationFilter}
          />
          <ViewSelector view={view} labels={labels.views} onChange={updateView} />
        </div>
      </header>

      {videos.length === 0 ? (
        <div className="bg-surface-container-low rounded-2xl p-10 text-center">
          <p className="text-on-surface-variant mb-3">{labels.empty}</p>
          <Link href="/channels" className="text-primary font-semibold hover:underline">
            {labels.addChannels}
          </Link>
        </div>
      ) : view === 'latest' ? (
        <LatestView
          rows={latestRows}
          locale={locale}
          labels={labels}
          onStatusChange={updateVideoStatus}
        />
      ) : filteredItems.length === 0 ? (
        <div className="bg-surface-container-low rounded-2xl p-10 text-center">
          <p className="text-on-surface-variant">{labels.noVideosForFilters}</p>
        </div>
      ) : view === 'list' ? (
        <DenseListView
          items={filteredItems}
          locale={locale}
          labels={labels}
          onStatusChange={updateVideoStatus}
        />
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <TrackerCard
              key={item.video.id}
              item={item}
              locale={locale}
              labels={labels}
              onStatusChange={(nextState) => updateVideoStatus(item.video.id, nextState)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ViewSelector({
  view,
  labels,
  onChange,
}: {
  view: TrackerViewMode
  labels: TrackerClientProps['labels']['views']
  onChange: (nextView: TrackerViewMode) => void
}) {
  return (
    <div className="inline-flex rounded-xl bg-surface-container-high p-1">
      <ViewButton label={labels.ribbon} active={view === 'ribbon'} onClick={() => onChange('ribbon')} icon={
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 4h14v3H3V4zm0 5h14v3H3V9zm0 5h14v3H3v-3z" /></svg>
      } />
      <ViewButton label={labels.list} active={view === 'list'} onClick={() => onChange('list')} icon={
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 4h3v3H3V4zm5 0h9v3H8V4zM3 9h3v3H3V9zm5 0h9v3H8V9zM3 14h3v3H3v-3zm5 0h9v3H8v-3z" /></svg>
      } />
      <ViewButton label={labels.latest} active={view === 'latest'} onClick={() => onChange('latest')} icon={
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 3a7 7 0 100 14 7 7 0 000-14zm1 3H9v5l4 2 .9-1.8L11 10.2V6z" /></svg>
      } />
    </div>
  )
}

function ViewButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
        active
          ? 'bg-primary-fixed text-on-primary-fixed'
          : 'text-on-surface-variant hover:bg-surface-container-highest'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function FilterMenu({
  isOpen,
  activeFiltersCount,
  labels,
  seenFilters,
  durationFilters,
  onToggleMenu,
  onToggleSeenFilter,
  onToggleDurationFilter,
}: {
  isOpen: boolean
  activeFiltersCount: number
  labels: TrackerClientProps['labels']['filters']
  seenFilters: SeenFilterState
  durationFilters: DurationFilterState
  onToggleMenu: () => void
  onToggleSeenFilter: (filterKey: SeenStatus) => void
  onToggleDurationFilter: (filterKey: DurationFilterKey) => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggleMenu}
        aria-expanded={isOpen}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-high text-on-surface text-xs font-bold uppercase tracking-[0.04em] hover:bg-surface-container-highest transition-colors"
      >
        <span>{labels.menu}</span>
        <span className="min-w-6 h-6 px-1 rounded-full bg-primary-fixed text-on-primary-fixed text-[11px] font-extrabold inline-flex items-center justify-center">
          {activeFiltersCount}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-surface-container-lowest border border-surface-container-high p-4 shadow-ambient">
          <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant mb-2">
            {labels.state}
          </p>
          <div className="space-y-2 mb-4">
            <FilterCheckbox
              label={labels.unseen}
              checked={seenFilters.unseen}
              onToggle={() => onToggleSeenFilter('unseen')}
            />
            <FilterCheckbox
              label={labels.seen}
              checked={seenFilters.seen}
              onToggle={() => onToggleSeenFilter('seen')}
            />
            <FilterCheckbox
              label={labels.hidden}
              checked={seenFilters.hidden}
              onToggle={() => onToggleSeenFilter('hidden')}
            />
          </div>

          <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant mb-2">
            {labels.duration}
          </p>
          <div className="space-y-2">
            <FilterCheckbox
              label={labels.durationUnder2m}
              checked={durationFilters.under2m}
              onToggle={() => onToggleDurationFilter('under2m')}
            />
            <FilterCheckbox
              label={labels.durationUnder5m}
              checked={durationFilters.under5m}
              onToggle={() => onToggleDurationFilter('under5m')}
            />
            <FilterCheckbox
              label={labels.durationBetween2m30m}
              checked={durationFilters.between2m30m}
              onToggle={() => onToggleDurationFilter('between2m30m')}
            />
            <FilterCheckbox
              label={labels.durationOver30m}
              checked={durationFilters.over30m}
              onToggle={() => onToggleDurationFilter('over30m')}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FilterCheckbox({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className="w-full inline-flex items-center gap-3 text-left rounded-xl px-2 py-2 hover:bg-surface-container-low transition-colors"
    >
      <span className={`w-5 h-5 rounded border inline-flex items-center justify-center ${
        checked ? 'border-emerald-600 bg-emerald-50 text-emerald-600' : 'border-surface-container-high text-transparent'
      }`}>
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.414l-7.07 7.07a1 1 0 01-1.414 0l-3.535-3.535a1 1 0 111.414-1.414l2.828 2.828 6.363-6.363a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </span>
      <span className="text-sm font-semibold text-on-surface">{label}</span>
    </button>
  )
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'primary' | 'neutral' | 'danger'
}) {
  const toneClasses = {
    primary: 'bg-primary-fixed text-on-primary-fixed',
    neutral: 'bg-surface-container-lowest text-on-surface',
    danger: 'bg-error text-white',
  }

  return (
    <article className={`rounded-2xl p-5 shadow-ambient ${toneClasses[tone]}`}>
      <p className="text-xs uppercase tracking-[0.05em] font-black opacity-80">{label}</p>
      <p className="font-headline text-3xl font-extrabold mt-2">{value}</p>
    </article>
  )
}

function TrackerCard({
  item,
  locale,
  labels,
  onStatusChange,
}: {
  item: VideoWithContext
  locale: string
  labels: TrackerClientProps['labels']
  onStatusChange: (nextState: { seenStatus: SeenStatus; seenAt: string | null; hiddenAt: string | null }) => void
}) {
  const isSeen = item.userState.seenStatus === 'seen'
  const isHidden = item.userState.seenStatus === 'hidden'
  const publishedLabel = formatPublishedDate(item.video.published_at, locale)
  const durationLabel = formatVideoDuration(item.video.duration_seconds)
  const durationBucketLabel = getDurationBucketLabel(item.video.duration_seconds, labels)
  const hasCompletedAnalysis = item.analysis?.analysis_status === 'completed'
  const statusTimestamp = getStatusTimestampLabel(item, locale, labels)

  return (
    <article className={`group flex flex-col md:flex-row gap-5 p-5 rounded-[1.75rem] transition-all ${
      isHidden
        ? 'bg-surface-container-high/70 opacity-85'
        : isSeen
          ? 'bg-surface-container-low/70'
          : 'bg-surface-container-lowest'
    }`}>
      <Link
        href={`/video/${item.video.id}`}
        className={`relative w-full md:w-72 lg:w-80 aspect-video rounded-2xl overflow-hidden shrink-0 ${
          isSeen || isHidden ? 'grayscale-[0.4]' : ''
        }`}
      >
        {item.video.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.video.thumbnail_url}
            alt={item.video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full bg-surface-container flex items-center justify-center">
            <svg className="w-12 h-12 text-on-surface-variant opacity-30" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {durationLabel ? (
          <div className="absolute bottom-3 right-3 bg-black/70 text-white text-[10px] font-bold px-2 py-1 rounded-md">
            {durationLabel}
          </div>
        ) : null}
      </Link>

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <SeenStatusButton
              videoId={item.video.id}
              initialStatus={item.userState.seenStatus}
              initialSeenAt={item.userState.seenAt}
              initialHiddenAt={item.userState.hiddenAt}
              variant="badge"
              onStatusChange={onStatusChange}
              labels={{
                seen: labels.badges.seen,
                unseen: labels.badges.unseen,
                hidden: labels.badges.hidden,
                markSeen: labels.actions.markSeen,
                markUnseen: labels.actions.markUnseen,
                hide: labels.actions.hide,
                unhide: labels.actions.unhide,
                error: labels.error,
              }}
            />
            {item.userState.isInWatchlist ? (
              <span className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full bg-tertiary-fixed text-on-tertiary-fixed">
                {labels.badges.watchlist}
              </span>
            ) : null}
            <span className="text-xs text-on-surface-variant">{publishedLabel}</span>
            {durationBucketLabel ? (
              <span className="text-xs text-on-surface-variant">{durationBucketLabel}</span>
            ) : null}
          </div>

          <h3 className="font-headline text-xl font-bold text-on-surface leading-tight line-clamp-2">
            {item.video.title}
          </h3>
          <p className="text-sm text-secondary font-semibold mt-1">
            {item.channel.title}
            {durationLabel ? ` · ${durationLabel}` : ''}
          </p>
          {statusTimestamp ? (
            <p className="text-xs text-on-surface-variant mt-1">{statusTimestamp}</p>
          ) : null}
          {item.localizedContent?.short_summary ? (
            <p className="text-sm text-on-surface-variant mt-2 line-clamp-2 ai-content">
              {item.localizedContent.short_summary}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {hasCompletedAnalysis ? (
            <Link
              href={`/video/${item.video.id}`}
              className="inline-flex items-center px-4 py-2 text-xs font-bold rounded-full gradient-primary text-on-primary"
            >
              {labels.viewSummary}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function DenseListView({
  items,
  locale,
  labels,
  onStatusChange,
}: {
  items: VideoWithContext[]
  locale: string
  labels: TrackerClientProps['labels']
  onStatusChange: (videoId: string, nextState: { seenStatus: SeenStatus; seenAt: string | null; hiddenAt: string | null }) => void
}) {
  return (
    <div className="bg-surface-container-lowest rounded-2xl overflow-auto shadow-ambient">
      <table className="min-w-full text-sm">
        <thead className="bg-surface-container-low text-on-surface-variant">
          <tr>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.video}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.channel}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.actions}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.generalCategory}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.subcategory}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.shortSummary}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            // Manteniamo le colonne AI presenti ma vuote, pronte per popolamento futuro.
            <tr
              key={item.video.id}
              className={`align-top ${index % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/50'}`}
            >
              <td className="px-3 py-3">
                <Link href={`/video/${item.video.id}`} className="flex items-start gap-3">
                  <div className="w-24 aspect-video rounded-lg overflow-hidden shrink-0 bg-surface-container">
                    {item.video.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.video.thumbnail_url} alt={item.video.title} className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-on-surface line-clamp-2">{item.video.title}</p>
                    <p className="text-xs text-on-surface-variant mt-1">{formatPublishedDate(item.video.published_at, locale)}</p>
                    <p className="text-xs text-on-surface-variant mt-1">{getDurationMetaLabel(item.video.duration_seconds, labels)}</p>
                    {(() => {
                      const statusInfo = getStatusTimestampLabel(item, locale, labels)
                      if (!statusInfo) return null
                      return <p className="text-xs text-on-surface-variant mt-1">{statusInfo}</p>
                    })()}
                  </div>
                </Link>
              </td>
              <td className="px-3 py-3 text-on-surface font-medium">{item.channel.title}</td>
              <td className="px-3 py-3">
                <SeenStatusButton
                  videoId={item.video.id}
                  initialStatus={item.userState.seenStatus}
                  initialSeenAt={item.userState.seenAt}
                  initialHiddenAt={item.userState.hiddenAt}
                  variant="button"
                  onStatusChange={(nextState) => onStatusChange(item.video.id, nextState)}
                  labels={{
                    seen: labels.badges.seen,
                    unseen: labels.badges.unseen,
                    hidden: labels.badges.hidden,
                    markSeen: labels.actions.markSeen,
                    markUnseen: labels.actions.markUnseen,
                    hide: labels.actions.hide,
                    unhide: labels.actions.unhide,
                    error: labels.error,
                  }}
                />
              </td>
              <td className="px-3 py-3 text-on-surface-variant">{labels.list.noData}</td>
              <td className="px-3 py-3 text-on-surface-variant">{labels.list.noData}</td>
              <td className="px-3 py-3 text-on-surface-variant">{labels.list.noData}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LatestView({
  rows,
  locale,
  labels,
  onStatusChange,
}: {
  rows: LatestRow[]
  locale: string
  labels: TrackerClientProps['labels']
  onStatusChange: (videoId: string, nextState: { seenStatus: SeenStatus; seenAt: string | null; hiddenAt: string | null }) => void
}) {
  return (
    <div className="bg-surface-container-lowest rounded-2xl overflow-auto shadow-ambient">
      <table className="min-w-full text-sm">
        <thead className="bg-surface-container-low text-on-surface-variant">
          <tr>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.video}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.channel}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.actions}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.generalCategory}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.subcategory}</th>
            <th className="px-3 py-3 text-left font-bold uppercase tracking-[0.04em]">{labels.list.headers.shortSummary}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.channelId} className={index % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/50'}>
              <td className="px-3 py-3">
                {row.item ? (
                  <Link href={`/video/${row.item.video.id}`} className="flex items-start gap-3">
                    <div className="w-24 aspect-video rounded-lg overflow-hidden shrink-0 bg-surface-container">
                      {row.item.video.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.item.video.thumbnail_url} alt={row.item.video.title} className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-on-surface line-clamp-2">{row.item.video.title}</p>
                      <p className="text-xs text-on-surface-variant mt-1">{formatPublishedDate(row.item.video.published_at, locale)}</p>
                      <p className="text-xs text-on-surface-variant mt-1">{getDurationMetaLabel(row.item.video.duration_seconds, labels)}</p>
                    </div>
                  </Link>
                ) : (
                  <p className="text-on-surface-variant">{labels.latest.emptyChannel}</p>
                )}
              </td>
              <td className="px-3 py-3 text-on-surface font-medium">{row.channelTitle}</td>
              <td className="px-3 py-3">
                {row.item ? (
                  <SeenStatusButton
                    videoId={row.item.video.id}
                    initialStatus={row.item.userState.seenStatus}
                    initialSeenAt={row.item.userState.seenAt}
                    initialHiddenAt={row.item.userState.hiddenAt}
                    variant="button"
                    onStatusChange={(nextState) => onStatusChange(row.item!.video.id, nextState)}
                    labels={{
                      seen: labels.badges.seen,
                      unseen: labels.badges.unseen,
                      hidden: labels.badges.hidden,
                      markSeen: labels.actions.markSeen,
                      markUnseen: labels.actions.markUnseen,
                      hide: labels.actions.hide,
                      unhide: labels.actions.unhide,
                      error: labels.error,
                    }}
                  />
                ) : null}
              </td>
              <td className="px-3 py-3 text-on-surface-variant">{labels.list.noData}</td>
              <td className="px-3 py-3 text-on-surface-variant">{labels.list.noData}</td>
              <td className="px-3 py-3 text-on-surface-variant">{labels.list.noData}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function buildLatestRows(
  videos: VideoWithContext[],
  channels: Array<{ id: string; title: string }>,
  selectedChannelId: string | null,
  locale: string
): LatestRow[] {
  const scopedChannels = selectedChannelId
    ? channels.filter((channel) => channel.id === selectedChannelId)
    : channels

  const sortedChannels = [...scopedChannels].sort((a, b) => a.title.localeCompare(b.title, locale))

  return sortedChannels.map((channel) => {
    const latestVideo = videos.find((item) => item.channel.id === channel.id)
    return {
      channelId: channel.id,
      channelTitle: channel.title,
      item: latestVideo ?? null,
    }
  })
}

function getStatusTimestampLabel(
  item: VideoWithContext,
  locale: string,
  labels: TrackerClientProps['labels']
): string | null {
  if (item.userState.seenStatus === 'seen' && item.userState.seenAt) {
    return labels.statusInfo.seenWithDate.replace('{date}', formatDateWithRelative(item.userState.seenAt, locale))
  }
  if (item.userState.seenStatus === 'hidden' && item.userState.hiddenAt) {
    return labels.statusInfo.hiddenWithDate.replace('{date}', formatDateWithRelative(item.userState.hiddenAt, locale))
  }
  return null
}

function getDurationBucketLabel(
  durationSeconds: number | null,
  labels: TrackerClientProps['labels']
): string {
  const bucket = getVideoDurationBucket(durationSeconds)
  if (bucket === 'under_2m') return labels.duration.under2m
  if (bucket === 'between_2m_30m') return labels.duration.between2m30m
  if (bucket === 'over_30m') return labels.duration.over30m
  return ''
}

function getDurationMetaLabel(
  durationSeconds: number | null,
  labels: TrackerClientProps['labels']
): string {
  const durationLabel = formatVideoDuration(durationSeconds)
  const bucketLabel = getDurationBucketLabel(durationSeconds, labels)
  if (!durationLabel) return labels.duration.unknown
  if (!bucketLabel) return durationLabel
  return `${durationLabel} · ${bucketLabel}`
}

function formatDateWithRelative(date: string, locale: string): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMinutes = Math.round(diffMs / (1000 * 60))
  const absDiffMinutes = Math.abs(diffMinutes)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  let relativeLabel = ''
  if (absDiffMinutes < 60) {
    relativeLabel = rtf.format(-diffMinutes, 'minute')
  } else if (absDiffMinutes < 60 * 24) {
    relativeLabel = rtf.format(-Math.round(diffMinutes / 60), 'hour')
  } else {
    relativeLabel = rtf.format(-Math.round(diffMinutes / (60 * 24)), 'day')
  }

  return `${relativeLabel} (${then.toLocaleString(locale)})`
}

function formatPublishedDate(date: string, locale: string): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  const diffD = Math.floor(diffH / 24)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diffH < 1) return rtf.format(0, 'hour')
  if (diffH < 24) return rtf.format(-diffH, 'hour')
  if (diffD < 7) return rtf.format(-diffD, 'day')

  return then.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: now.getFullYear() === then.getFullYear() ? undefined : 'numeric',
  })
}
