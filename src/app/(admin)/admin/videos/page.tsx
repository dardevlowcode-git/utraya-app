/* Commento didattico:
 * Scopo del file: pagina admin per consultare il contenuto canonico video e lo stato dei riepiloghi AI.
 * Moduli richiamati: `next`, `next-intl/server`, `@/lib/supabase/admin`
 * Flusso: carica video canonici + contenuto localizzato e mostra una vista sintetica per revisione in console admin.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Admin - Contenuto canonico',
}

/**
 * Pagina admin per rivedere i contenuti canonici esistenti.
 */
export default async function AdminCanonicalVideosPage() {
  const supabase = createAdminClient()
  const t = await getTranslations()
  const locale = await getLocale()

  const { data: videos, error } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      youtube_video_id,
      published_at,
      channel:channels(title),
      localized:video_localized_content(language_code, short_summary, is_admin_edited)
    `)
    .order('published_at', { ascending: false })
    .limit(100)

  if (error) {
    return (
      <div className="p-8 max-w-7xl">
        <h1 className="font-headline text-3xl font-extrabold text-on-surface mb-2">
          {t('admin.content.title')}
        </h1>
        <p className="text-sm text-error">
          Errore caricamento contenuto canonico: {error.message}
        </p>
      </div>
    )
  }

  const rows = ((videos ?? []) as unknown) as Array<{
    id: string
    title: string
    youtube_video_id: string
    published_at: string
    channel: { title: string } | null
    localized: Array<{ language_code: string; short_summary: string | null; is_admin_edited: boolean }> | null
  }>

  return (
    <div className="p-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-extrabold text-on-surface mb-1">
          {t('admin.content.title')}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {t('admin.content.subtitle')}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-ambient text-sm text-on-surface-variant">
          Nessun contenuto canonico disponibile.
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-2xl shadow-ambient overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_120px_180px] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-on-surface-variant border-b border-surface-container-high">
            <span>Video</span>
            <span>Canale</span>
            <span>Lingue</span>
            <span>Pubblicato</span>
          </div>

          <div className="divide-y divide-surface-container-high">
            {rows.map((video) => {
              const localized = video.localized ?? []
              const languages = localized.map((x) => x.language_code.toUpperCase()).join(', ')
              const anyAdminEdited = localized.some((x) => x.is_admin_edited)

              return (
                <div key={video.id} className="grid grid-cols-[2fr_1fr_120px_180px] gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-on-surface truncate">{video.title}</p>
                    <p className="text-xs text-on-surface-variant truncate">
                      {video.youtube_video_id}
                    </p>
                    {anyAdminEdited ? (
                      <span className="inline-flex mt-1 text-[10px] px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed">
                        {t('admin.content.adminEdited')}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-on-surface-variant truncate">{video.channel?.title ?? '—'}</div>
                  <div className="text-on-surface-variant">{languages || '—'}</div>
                  <div className="text-on-surface-variant">
                    {new Date(video.published_at).toLocaleString(locale)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
