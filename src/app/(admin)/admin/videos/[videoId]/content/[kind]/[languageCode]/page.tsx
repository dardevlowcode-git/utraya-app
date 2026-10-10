/* Commento didattico:
 * Scopo del file: pagina admin di lettura di un singolo testo canonico persistito.
 * Moduli richiamati: servizio admin, Next navigation e collegamento alla tabella video.
 * Flusso: verifica il tipo richiesto, carica solo video/sezione/lingua e mostra i campi vuoti come «—».
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  loadAdminCanonicalContentDetail,
} from '@/lib/services/admin-canonical-content'
import type { AdminCanonicalContentKind } from '@/lib/view-models/admin-canonical-content'

interface AdminCanonicalContentDetailPageProps {
  params: Promise<{ videoId: string; kind: string; languageCode: string }>
}

/** Accetta soltanto le sezioni canoniche che possono essere consultate dalla tabella admin. */
function isContentKind(kind: string): kind is AdminCanonicalContentKind {
  return kind === 'transcript' || kind === 'summary' || kind === 'category'
}

/** Carica il contenuto già salvato e lo rende in una vista admin di sola lettura. */
export default async function AdminCanonicalContentDetailPage({
  params,
}: AdminCanonicalContentDetailPageProps) {
  const { videoId, kind, languageCode } = await params
  if (!isContentKind(kind)) notFound()

  const result = await loadAdminCanonicalContentDetail({ videoId, kind, languageCode })
  if (result.status === 'unauthorized') redirect('/admin/login')
  if (result.status === 'not_found') notFound()

  if (result.status === 'error') {
    return (
      <div className="max-w-4xl p-8">
        <Link href="/admin/videos" className="text-sm underline underline-offset-2">
          ← Contenuto canonico
        </Link>
        <p role="alert" className="mt-6 text-sm text-error">
          Errore caricamento contenuto canonico: {result.message} ({result.code})
        </p>
      </div>
    )
  }

  const detail = result.data
  const sectionTitle = kind === 'transcript'
    ? 'Trascrizione'
    : kind === 'summary'
      ? 'Riassunti'
      : 'Categorie'

  return (
    <article className="max-w-4xl p-8">
      <Link href="/admin/videos" className="text-sm underline underline-offset-2">
        ← Contenuto canonico
      </Link>
      <header className="mb-6 mt-4">
        <p className="text-sm text-on-surface-variant">{sectionTitle} · {detail.languageCode.toUpperCase()}</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">{detail.videoTitle}</h1>
      </header>
      <div className="space-y-6">
        {detail.fields.map((field) => (
          <section key={field.label} className="rounded-2xl bg-surface-container-lowest p-6 shadow-ambient">
            <h2 className="mb-3 text-lg font-semibold text-on-surface">{field.label}</h2>
            {field.text === null ? (
              <p className="text-on-surface-variant">—</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-body text-sm text-on-surface">{field.text}</pre>
            )}
          </section>
        ))}
      </div>
    </article>
  )
}
