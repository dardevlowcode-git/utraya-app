/* Commento didattico:
 * Scopo del file: pagina admin per consultare il contenuto canonico video e lo stato dei riepiloghi AI.
 * Moduli richiamati: `next`, `next-intl/server`, view service admin e cella contenuto canonico.
 * Flusso: carica metadati dei contenuti localizzati e mostra link di lettura nella console admin.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import CanonicalContentCell from '@/components/admin/CanonicalContentCell'
import { loadAdminCanonicalVideos } from '@/lib/services/admin-canonical-content'

export const metadata: Metadata = {
  title: 'Admin - Contenuto canonico',
}

/**
 * Pagina admin per rivedere i contenuti canonici esistenti.
 */
export default async function AdminCanonicalVideosPage() {
  const result = await loadAdminCanonicalVideos()
  if (result.status === 'unauthorized') redirect('/admin/login')
  if (result.status === 'not_found') notFound()

  const t = await getTranslations()
  const locale = await getLocale()

  if (result.status === 'error') {
    return (
      <div className="p-8 max-w-7xl">
        <h1 className="font-headline text-3xl font-extrabold text-on-surface mb-2">
          {t('admin.content.title')}
        </h1>
        <p className="text-sm text-error">
          Errore caricamento contenuto canonico: {result.message} ({result.code})
        </p>
      </div>
    )
  }

  const rows = result.data

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
        <div className="overflow-x-auto rounded-2xl shadow-ambient">
          <table className="w-full min-w-[1120px] bg-surface-container-lowest text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container-high text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                <th scope="col" className="px-4 py-3">Video</th>
                <th scope="col" className="px-4 py-3">Canale</th>
                <th scope="col" className="px-4 py-3">Lingue</th>
                <th scope="col" className="px-4 py-3">Pubblicato</th>
                <th scope="col" className="px-4 py-3">Trascrizione</th>
                <th scope="col" className="px-4 py-3">Riassunti</th>
                <th scope="col" className="px-4 py-3">Categorie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high">
              {rows.map((video) => (
                <tr key={video.id}>
                  <th scope="row" className="min-w-56 px-4 py-3 font-normal">
                    <p className="font-semibold text-on-surface truncate">{video.title}</p>
                    <p className="text-xs text-on-surface-variant truncate">{video.youtubeVideoId}</p>
                    {video.isAdminEdited ? (
                      <span className="inline-flex mt-1 text-[10px] px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed">
                        {t('admin.content.adminEdited')}
                      </span>
                    ) : null}
                  </th>
                  <td className="px-4 py-3 text-on-surface-variant">{video.channelTitle ?? '—'}</td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {video.languages.map((language) => language.toUpperCase()).join(', ') || '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">
                    {new Date(video.publishedAt).toLocaleString(locale)}
                  </td>
                  <td className="px-4 py-3"><CanonicalContentCell label="Trascrizione" items={video.transcripts} /></td>
                  <td className="px-4 py-3"><CanonicalContentCell label="Riassunti" items={video.summaries} /></td>
                  <td className="px-4 py-3"><CanonicalContentCell label="Categorie" items={video.categories} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
