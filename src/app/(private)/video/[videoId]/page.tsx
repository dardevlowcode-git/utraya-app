/* Commento didattico:
 * Scopo del file: definisce una pagina o layout protetto: viene usato dopo l'autenticazione dell'utente.
 * Moduli richiamati: `next`, `@/lib/auth/provider`, `@/lib/supabase/server`, `next/navigation`, `next-intl/server`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { getCurrentSession } from '@/lib/auth/provider'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import VideoActionsClient from './VideoActionsClient'
import VideoEmbedPlayer from './VideoEmbedPlayer'
import { extractYouTubeVideoId } from '@/lib/utils/youtube-video-id'

export const metadata: Metadata = {
  title: 'Analisi Video',
}

interface Props {
  params: Promise<{ videoId: string }>
}

export default async function VideoDetailPage({ params }: Props) {
  const { videoId } = await params
  const session = await getCurrentSession()
  if (!session) notFound()
  const supabase = await createClient()
  const t = await getTranslations()
  const locale = await getLocale()

  // Fetch video with full context
  const { data: video } = await supabase
    .from('videos')
    .select(`
      *,
      channels(id, title, handle, thumbnail_url),
      video_analysis(id, analysis_status, model_used, analyzed_at),
      video_localized_content!left(*)
    `)
    .eq('id', videoId)
    .single()

  if (!video) notFound()

  const [{ data: userVideoState }, { data: watchlistItem }] = await Promise.all([
    supabase
      .from('user_video_states')
      .select('seen_status')
      .eq('user_id', session.userId)
      .eq('video_id', videoId)
      .maybeSingle(),
    supabase
      .from('watchlist_items')
      .select('id, watchlists!inner(user_id)')
      .eq('video_id', videoId)
      .eq('watchlists.user_id', session.userId)
      .maybeSingle(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis = (video as any).video_analysis?.[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (video as any).video_localized_content?.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => c.language_code === session?.preferredLanguage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) ?? (video as any).video_localized_content?.[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channel = (video as any).channels

  const isAnalyzed = analysis?.analysis_status === 'completed'
  const fallbackMetadataVideoId = (() => {
    const raw = video.youtube_metadata
    if (!raw || typeof raw !== 'object' || !('contentDetails' in raw)) return null
    const contentDetails = raw.contentDetails
    if (!contentDetails || typeof contentDetails !== 'object' || !('videoId' in contentDetails)) return null
    const value = contentDetails.videoId
    return typeof value === 'string' ? value : null
  })()

  const youtubeVideoId = extractYouTubeVideoId(video.youtube_video_id)
    ?? extractYouTubeVideoId(video.video_url)
    ?? extractYouTubeVideoId(fallbackMetadataVideoId)

  const embedUrl = youtubeVideoId
    ? `https://www.youtube-nocookie.com/embed/${youtubeVideoId}`
    : null

  // Format duration
  function formatDuration(seconds: number | null): string {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="p-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl">

        {/* MAIN COLUMN */}
        <div className="lg:col-span-2 space-y-6">

          {/* Thumbnail / video embed */}
          <div className="relative rounded-2xl overflow-hidden bg-surface-container aspect-video shadow-ambient">
            {embedUrl ? (
              <VideoEmbedPlayer
                youtubeVideoId={youtubeVideoId!}
                title={video.title}
              />
            ) : video.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={video.thumbnail_url}
                alt={video.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-20 h-20 gradient-ai rounded-full flex items-center justify-center opacity-30">
                  <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
            )}
            {video.duration_seconds && (
              <div className="absolute bottom-3 right-3 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg">
                {formatDuration(video.duration_seconds)}
              </div>
            )}
          </div>

          {/* Title + actions */}
          <div>
            <h1 className="font-headline text-2xl font-bold text-on-surface leading-tight mb-2">
              {video.title}
            </h1>
            <p className="text-sm text-on-surface-variant mb-4">
              {t('video.publishedBy')}{' '}
              <a href={`/channels/${channel?.id}`} className="text-secondary font-medium hover:underline">
                {channel?.title}
              </a>
              {video.published_at && (
                <> · {new Date(video.published_at).toLocaleDateString(locale, {
                  day: 'numeric', month: 'long', year: 'numeric'
                })}</>
              )}
            </p>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <VideoActionsClient
                videoId={video.id}
                initialSeen={userVideoState?.seen_status === 'seen'}
                initialInWatchlist={Boolean(watchlistItem?.id)}
                labels={{
                  markSeen: t('dashboard.markSeen'),
                  markUnseen: t('dashboard.markUnseen'),
                  addToWatchlist: t('dashboard.addToWatchlist'),
                  removeFromWatchlist: t('dashboard.removeFromWatchlist'),
                  genericError: t('common.error'),
                }}
              />
              <a
                href={video.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface
                           px-5 py-2.5 rounded-full font-semibold text-sm transition-all ghost-border"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.28 6.28 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.05a8.19 8.19 0 004.78 1.52V7.12a4.85 4.85 0 01-1.01-.43z"/>
                </svg>
                {t('video.watchOnYoutube')}
              </a>
            </div>
          </div>

          {/* AI Analysis block */}
          {isAnalyzed && content ? (
            <div className="bg-surface-container-lowest rounded-2xl p-6 space-y-6 shadow-ambient">
              {/* AI header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 gradient-ai rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-on-surface">{t('video.aiAnalysisTitle')}</p>
                  <p className="text-xs text-on-surface-variant">
                    {analysis.model_used ?? 'Gemini'} · {' '}
                    {analysis.analyzed_at
                      ? new Date(analysis.analyzed_at).toLocaleDateString(locale)
                      : ''}
                  </p>
                </div>
              </div>

              {/* Short summary */}
              {content.short_summary && (
                <div>
                  <p className="text-label-caps text-on-surface-variant mb-2">{t('video.bottomLine')}</p>
                  <p className="text-lg font-semibold text-tertiary leading-relaxed ai-content">
                    &ldquo;{content.short_summary}&rdquo;
                  </p>
                </div>
              )}

              {/* Full summary */}
              {content.full_summary && (
                <div>
                  <p className="text-label-caps text-on-surface-variant mb-2">{t('video.deepDive')}</p>
                  <p className="text-on-surface leading-relaxed">
                    {content.full_summary}
                  </p>
                </div>
              )}

              {/* Context + Key moments */}
              <div className="grid grid-cols-2 gap-6">
                {(content.general_category || content.subcategory) && (
                  <div>
                    <p className="text-label-caps text-on-surface-variant mb-3">{t('video.context')}</p>
                    <div className="flex flex-wrap gap-2">
                      {content.general_category && (
                        <span className="px-3 py-1 bg-surface-container rounded-full text-sm text-on-surface-variant">
                          {content.general_category}
                        </span>
                      )}
                      {content.subcategory && (
                        <span className="px-3 py-1 bg-surface-container rounded-full text-sm text-on-surface-variant">
                          {content.subcategory}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {content.highlights_text && (
                  <div>
                    <p className="text-label-caps text-on-surface-variant mb-3">{t('video.keyMoments')}</p>
                    <div className="space-y-2">
                      {content.highlights_text.split('\n').slice(0, 5).map((line: string, i: number) => (
                        <p key={i} className="text-sm text-on-surface-variant">{line}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : analysis?.analysis_status === 'processing' ? (
            <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-ambient">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 gradient-ai rounded-xl flex items-center justify-center animate-pulse">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-on-surface">{t('dashboard.analysisInProgress')}</p>
                  <p className="text-sm text-on-surface-variant">{t('video.analysisPendingDetail')}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-surface-container-low rounded-2xl p-6">
              <p className="text-on-surface-variant text-sm">
                {t('video.analysisNotAvailableDetail')}{' '}
                <a href="/integrations" className="text-primary hover:underline">{t('nav.integrations')}</a>.
              </p>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-6">
          {/* Related videos placeholder */}
          <div className="bg-surface-container-lowest rounded-2xl p-5 shadow-ambient">
            <h3 className="font-headline text-base font-bold text-on-surface mb-4">
              {t('video.relatedIntelligence')}
            </h3>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 group cursor-pointer">
                  <div className="w-24 h-14 bg-surface-container rounded-xl shrink-0 skeleton" />
                  <div className="flex-1 min-w-0 space-y-2 pt-1">
                    <div className="skeleton h-3 rounded w-full" />
                    <div className="skeleton h-3 rounded w-3/4" />
                    <div className="skeleton h-2 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
