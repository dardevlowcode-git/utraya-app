/* Commento didattico:
 * Scopo del file: definisce una pagina o layout protetto: viene usato dopo l'autenticazione dell'utente.
 * Moduli richiamati: `next`, `@/lib/auth/provider`, `@/lib/supabase/server`, `next-intl/server`, `next/navigation`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { getCurrentSession } from '@/lib/auth/provider'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import { getLocale, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { formatVideoDuration, getVideoDurationBucket } from '@/lib/utils/video-duration'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default async function DashboardPage() {
  const session = await getCurrentSession()
  if (!session) {
    redirect('/login')
  }

  const supabase = await createClient()
  const t = await getTranslations()
  const locale = await getLocale()
  type UserChannelRow = Database['public']['Tables']['user_channels']['Row']

  const { data: userChannelsData } = await supabase
    .from('user_channels')
    .select('channel_id')
    .eq('user_id', session.userId)
    .eq('is_active', true)
    .order('added_at', { ascending: false })
    .limit(10)
  const userChannels = (userChannelsData ?? []) as Pick<UserChannelRow, 'channel_id'>[]

  const channelIds = userChannels?.map((uc) => uc.channel_id) ?? []

  const { data: recentVideosData } = channelIds.length > 0
    ? await supabase
        .from('videos')
        .select(`
          *,
          channels(id, title, handle, thumbnail_url),
          video_analysis(id, analysis_status),
          video_localized_content!left(id, short_summary, language_code)
        `)
        .in('channel_id', channelIds)
        .eq('availability_status', 'available')
        .eq('video_type', 'standard')
        .order('published_at', { ascending: false })
        .limit(12)
    : { data: [] }

  const recentVideos = (recentVideosData ?? []) as Array<Record<string, any>>
  const videoIds = recentVideos.map((v) => v.id as string)
  const { data: userVideoStatesData } = videoIds.length > 0
    ? await supabase
        .from('user_video_states')
        .select('video_id, seen_status')
        .eq('user_id', session.userId)
        .in('video_id', videoIds)
    : { data: [] }

  const userVideoStates = (userVideoStatesData ?? []) as Array<{ video_id: string; seen_status: string }>
  const seenMap = new Map(userVideoStates.map((s) => [s.video_id, s.seen_status]))
  const recentVideosWithState: any[] = recentVideos.map((video: any) => ({
    ...video,
    __seenStatus: seenMap.get(video.id) ?? 'unseen',
  }))

  const hasChannels = (userChannels?.length ?? 0) > 0
  const newAnalysesCount = recentVideosWithState?.filter(
    (v) => v.video_analysis?.[0]?.analysis_status === 'completed'
  ).length ?? 0

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-12">
        <h1 className="font-headline text-4xl font-extrabold tracking-tight text-on-surface mb-2">
          {t('dashboard.title')}
        </h1>
        <p className="text-on-surface-variant text-lg">
          {newAnalysesCount > 0
            ? t('dashboard.subtitle', { count: newAnalysesCount })
            : hasChannels
              ? t('dashboard.subtitleNone')
              : t('dashboard.addFirstChannel')}
        </p>
      </header>

      {!hasChannels ? (
        <EmptyState
          title={t('dashboard.noChannels')}
          subtitle={t('dashboard.emptyFeed')}
          cta={t('dashboard.addFirstChannel')}
        />
      ) : (
        <VideoBentoGrid
          videos={recentVideosWithState ?? []}
          locale={locale}
          labels={{
            unseen: t('dashboard.unseen'),
            seen: t('dashboard.seen'),
            analysisComplete: t('dashboard.analysisComplete'),
            processing: t('dashboard.analysisInProgress'),
            unknownChannel: t('dashboard.unknownChannel'),
            viewSummary: t('dashboard.viewSummary'),
            noVideosYet: t('dashboard.noVideosYet'),
            durationUnknown: t('dashboard.duration.unknown'),
            durationUnder2m: t('dashboard.duration.under2m'),
            durationBetween2m30m: t('dashboard.duration.between2m30m'),
            durationOver30m: t('dashboard.duration.over30m'),
          }}
        />
      )}
    </div>
  )
}

function EmptyState({ title, subtitle, cta }: { title: string; subtitle: string; cta: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 gradient-ai rounded-3xl flex items-center justify-center mb-6 shadow-tertiary-glow">
        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      </div>
      <h2 className="font-headline text-2xl font-bold text-on-surface mb-3">
        {title}
      </h2>
      <p className="text-on-surface-variant max-w-sm mb-8 leading-relaxed">
        {subtitle}
      </p>
      <a
        href="/channels"
        className="inline-flex items-center gap-2 gradient-primary text-on-primary px-6 py-3
                   rounded-full font-bold hover:shadow-primary-glow transition-all active:scale-95"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {cta}
      </a>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function VideoBentoGrid({
  videos,
  locale,
  labels,
}: {
  videos: any[]
  locale: string
  labels: {
    unseen: string
    seen: string
    analysisComplete: string
    processing: string
    unknownChannel: string
    viewSummary: string
    noVideosYet: string
    durationUnknown: string
    durationUnder2m: string
    durationBetween2m30m: string
    durationOver30m: string
  }
}) {
  if (videos.length === 0) {
    return (
      <div className="bg-surface-container-low rounded-2xl p-12 text-center">
        <p className="text-on-surface-variant">
          {labels.noVideosYet}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {videos.slice(0, 6).map((video, index) => {
        const isLarge = index === 0
        const analysis = video.video_analysis?.[0]
        const content = video.video_localized_content?.[0]
        const channel = video.channels
        const seenStatus = video.__seenStatus

        return (
          <article
            key={video.id}
            className={`bg-surface-container-lowest rounded-2xl p-5 group cursor-pointer
                        hover:bg-surface-container transition-all duration-300 shadow-ambient
                        ${isLarge ? 'lg:col-span-2' : ''}`}
          >
            <a href={`/video/${video.id}`} className="block">
              <div className={`relative mb-5 rounded-xl overflow-hidden bg-surface-container
                               ${isLarge ? 'aspect-video' : 'aspect-video'}`}>
                {video.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={video.thumbnail_url}
                    alt={video.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-12 h-12 text-on-surface-variant opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                  </div>
                )}

                <div className="absolute top-3 left-3">
                  {seenStatus === 'seen' ? (
                    <span className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full">
                      {labels.seen}
                    </span>
                  ) : !analysis || analysis.analysis_status === 'pending' ? (
                    <span className="badge-unseen">{labels.unseen}</span>
                  ) : analysis.analysis_status === 'completed' ? (
                    <span className="badge-ai">{labels.analysisComplete}</span>
                  ) : analysis.analysis_status === 'processing' ? (
                    <span className="px-3 py-1 bg-amber-400 text-white text-xs font-bold rounded-full">
                      {labels.processing}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className={`font-headline font-bold text-on-surface leading-tight mb-1 line-clamp-2
                                  ${isLarge ? 'text-xl' : 'text-base'}`}>
                    {video.title}
                  </h3>
                  <p className="text-sm text-secondary font-medium">
                    {channel?.title ?? labels.unknownChannel}
                    {video.published_at && (
                      <> · <RelativeTime date={video.published_at} locale={locale} /></>
                    )}
                    {' · '}
                    {formatDashboardDuration(video.duration_seconds, labels)}
                  </p>
                  {content?.short_summary && (
                    <p className="mt-2 text-sm text-on-surface-variant line-clamp-2 ai-content">
                      {content.short_summary}
                    </p>
                  )}
                </div>

                {analysis?.analysis_status === 'completed' && (
                  <button
                    className="shrink-0 gradient-ai text-white px-4 py-2 rounded-full text-sm
                               font-semibold hover:shadow-tertiary-glow transition-all active:scale-95"
                  >
                    {labels.viewSummary}
                  </button>
                )}
              </div>
            </a>
          </article>
        )
      })}
    </div>
  )
}

function formatDashboardDuration(
  durationSeconds: number | null,
  labels: VideoBentoGridProps['labels']
): string {
  const duration = formatVideoDuration(durationSeconds)
  const bucket = getVideoDurationBucket(durationSeconds)
  if (!duration) return labels.durationUnknown
  if (bucket === 'under_2m') return `${duration} · ${labels.durationUnder2m}`
  if (bucket === 'between_2m_30m') return `${duration} · ${labels.durationBetween2m30m}`
  if (bucket === 'over_30m') return `${duration} · ${labels.durationOver30m}`
  return duration
}

type VideoBentoGridProps = {
  videos: any[]
  locale: string
  labels: {
    unseen: string
    seen: string
    analysisComplete: string
    processing: string
    unknownChannel: string
    viewSummary: string
    noVideosYet: string
    durationUnknown: string
    durationUnder2m: string
    durationBetween2m30m: string
    durationOver30m: string
  }
}

function RelativeTime({ date, locale }: { date: string; locale: string }) {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  const diffD = Math.floor(diffH / 24)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diffH < 1) return <span>{rtf.format(0, 'hour')}</span>
  if (diffH < 24) return <span>{rtf.format(-diffH, 'hour')}</span>
  if (diffD < 7) return <span>{rtf.format(-diffD, 'day')}</span>
  return <span>{then.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>
}
