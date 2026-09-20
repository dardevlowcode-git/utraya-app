/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `next`, `@/lib/supabase/admin`, `next-intl/server`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLocale, getTranslations } from 'next-intl/server'
import AdminScanNowButton from './AdminScanNowButton'

export const metadata: Metadata = { title: 'Admin — Canali' }

export default async function AdminChannelsPage() {
  const supabase = createAdminClient()
  const t = await getTranslations()
  const locale = await getLocale()

  const { data: channels } = await supabase
    .from('channels')
    .select('*, canonical_sync_state(*)')
    .order('created_at', { ascending: false })
    .limit(50)
  // Tipizzazione esplicita difensiva: la select con relazione annidata puo` essere inferita come `never`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRows = (channels ?? []) as any[]

  const channelIds = channelRows.map((c) => c.id as string)
  const [userChannelsResult, videosResult] = await Promise.all([
    channelIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ channel_id: string }> })
      : supabase
        .from('user_channels')
        .select('channel_id')
        .in('channel_id', channelIds)
        .eq('is_active', true),
    channelIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ channel_id: string }> })
      : supabase
        .from('videos')
        .select('channel_id')
        .in('channel_id', channelIds),
  ])

  const followerCountByChannelId = new Map<string, number>()
  for (const row of userChannelsResult.data ?? []) {
    followerCountByChannelId.set(
      row.channel_id,
      (followerCountByChannelId.get(row.channel_id) ?? 0) + 1
    )
  }

  const canonicalVideoCountByChannelId = new Map<string, number>()
  for (const row of videosResult.data ?? []) {
    canonicalVideoCountByChannelId.set(
      row.channel_id,
      (canonicalVideoCountByChannelId.get(row.channel_id) ?? 0) + 1
    )
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-10">
        <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface mb-1">
          {t('admin.content.title')}
        </h1>
        <p className="text-on-surface-variant text-sm">
          {t('admin.channels.subtitle', { count: channels?.length ?? 0 })}
        </p>
      </header>

      <div className="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-ambient">
        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-surface-container-low">
          <div className="col-span-4 text-label-caps text-on-surface-variant">{t('nav.channels')}</div>
          <div className="col-span-2 text-label-caps text-on-surface-variant">{t('admin.channels.subscribers')}</div>
          <div className="col-span-2 text-label-caps text-on-surface-variant">{t('admin.channels.lastSync')}</div>
          <div className="col-span-2 text-label-caps text-on-surface-variant">{t('admin.users.status')}</div>
          <div className="col-span-1 text-label-caps text-on-surface-variant">{t('admin.channels.videos')}</div>
          <div className="col-span-1 text-label-caps text-on-surface-variant text-right">{t('admin.users.actions')}</div>
        </div>
        {channelRows.length === 0 ? (
          <div className="p-12 text-center text-on-surface-variant">{t('admin.channels.empty')}</div>
        ) : (
          channelRows.map((ch, i) => {
            const sync = ch.canonical_sync_state

            return (
              <div
                key={ch.id}
                className={`grid grid-cols-12 gap-4 px-6 py-4 items-center
                             ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}
                             hover:bg-surface-container transition-colors`}
              >
                <div className="col-span-4 flex items-center gap-3">
                  {ch.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ch.thumbnail_url} alt="" className="w-8 h-8 rounded-full" />
                  ) : (
                    <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-white text-sm font-bold">
                      {ch.title[0]}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{ch.title}</p>
                    <p className="text-xs text-on-surface-variant">{ch.handle ? `@${ch.handle}` : ch.youtube_channel_id}</p>
                  </div>
                </div>
                <div className="col-span-2 text-sm text-on-surface-variant">
                  {new Intl.NumberFormat(locale).format(
                    followerCountByChannelId.get(ch.id as string) ?? 0
                  )}
                </div>
                <div className="col-span-2 text-sm text-on-surface-variant">
                  {sync?.last_sync_at ? new Date(sync.last_sync_at).toLocaleDateString(locale) : '—'}
                </div>
                <div className="col-span-2">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full
                    ${ch.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-error-container text-error'}`}>
                    {ch.status === 'active' ? t('admin.users.statusActive') : t('common.error')}
                  </span>
                </div>
                <div className="col-span-1 text-sm text-on-surface-variant">
                  {new Intl.NumberFormat(locale).format(
                    canonicalVideoCountByChannelId.get(ch.id as string) ?? 0
                  )}
                </div>
                <div className="col-span-1 flex justify-end">
                  <AdminScanNowButton channelId={ch.id} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
