/* Commento didattico:
 * Scopo del file: definisce una pagina o layout protetto: viene usato dopo l'autenticazione dell'utente.
 * Moduli richiamati: `next`, `@/lib/auth/provider`, `@/lib/supabase/server`, `next-intl/server`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { getCurrentSession } from '@/lib/auth/provider'
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import { formatVideoDuration, getVideoDurationBucket } from '@/lib/utils/video-duration'

export const metadata: Metadata = {
  title: 'Watchlist',
}

export default async function WatchlistPage() {
  const session = await getCurrentSession()
  const supabase = await createClient()
  const t = await getTranslations()

  const { data: watchlist } = await supabase
    .from('watchlists')
    .select('*')
    .eq('user_id', session!.userId)
    .eq('is_default', true)
    .single()

  const { data: items } = watchlist
    ? await supabase
        .from('watchlist_items')
        .select(`
          *,
          videos(
            id, title, thumbnail_url, published_at, duration_seconds,
            channels(id, title, handle)
          )
        `)
        .eq('watchlist_id', watchlist.id)
        .order('added_at', { ascending: false })
    : { data: [] }

  return (
    <div className="p-8 max-w-5xl">
      <header className="mb-10">
        <h1 className="font-headline text-4xl font-extrabold tracking-tight text-on-surface mb-2">
          {t('watchlist.title')}
        </h1>
        <p className="text-on-surface-variant">
          {items?.length
            ? t('watchlist.count', { count: items.length })
            : t('watchlist.subtitle')}
        </p>
      </header>

      {!items || items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 bg-surface-container rounded-3xl flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-on-surface-variant opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
          </div>
          <h2 className="font-headline text-xl font-bold text-on-surface mb-2">{t('watchlist.empty')}</h2>
          <p className="text-on-surface-variant max-w-sm mb-6 text-sm leading-relaxed">
            {t('watchlist.emptyDetail')}
          </p>
          <a
            href="/dashboard"
            className="text-sm text-primary font-semibold hover:underline"
          >
            ← {t('watchlist.backToDashboard')}
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {items.map((item: any) => {
            const video = item.videos
            const channel = video?.channels

            return (
              <article
                key={item.id}
                className="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-ambient
                           hover:bg-surface-container transition-all group"
              >
                <a href={`/video/${video?.id}`} className="block">
                  <div className="aspect-video bg-surface-container relative overflow-hidden">
                    {video?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.thumbnail_url}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center opacity-20">
                        <svg className="w-10 h-10 text-on-surface" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-xs text-secondary font-medium mb-1">
                      {channel?.title}
                      {' · '}
                      {formatWatchlistDuration(video?.duration_seconds ?? null, {
                        unknown: t('watchlist.duration.unknown'),
                        under2m: t('watchlist.duration.under2m'),
                        between2m30m: t('watchlist.duration.between2m30m'),
                        over30m: t('watchlist.duration.over30m'),
                      })}
                    </p>
                    <h3 className="font-bold text-on-surface text-sm line-clamp-2">{video?.title}</h3>
                  </div>
                </a>
                <div className="px-4 pb-4">
                  <button
                    className="text-xs text-on-surface-variant hover:text-error transition-colors font-medium"
                  >
                    {t('watchlist.removeFromList')}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatWatchlistDuration(
  durationSeconds: number | null,
  labels: {
    unknown: string
    under2m: string
    between2m30m: string
    over30m: string
  }
): string {
  const duration = formatVideoDuration(durationSeconds)
  if (!duration) return labels.unknown

  const bucket = getVideoDurationBucket(durationSeconds)
  if (bucket === 'under_2m') return `${duration} · ${labels.under2m}`
  if (bucket === 'between_2m_30m') return `${duration} · ${labels.between2m30m}`
  if (bucket === 'over_30m') return `${duration} · ${labels.over30m}`
  return duration
}
