/* Commento didattico:
 * Scopo: definisce i dati serializzabili della tabella admin per contenuti canonici.
 * Moduli richiamati: nessuno; riceve forme DB già selezionate dal service admin.
 * Flusso: converte le righe in metadati e link, senza trasferire i testi alla tabella.
 */

export interface AdminCanonicalLocalizedContentInput {
  languageCode: string
  shortSummary: string | null
  fullSummary: string | null
  generalCategory: string | null
  subcategory: string | null
  isAdminEdited: boolean
}

export interface AdminCanonicalTranscriptInput {
  languageCode: string
  transcriptText: string | null
}

export interface AdminCanonicalVideoInput {
  id: string
  title: string
  youtubeVideoId: string
  publishedAt: string
  channelTitle: string | null
  localizedContent: AdminCanonicalLocalizedContentInput[]
  transcripts: AdminCanonicalTranscriptInput[]
}

export interface AdminCanonicalContentLinkViewModel {
  languageCode: string
  href: string | null
}

export type AdminCanonicalContentKind = 'transcript' | 'summary' | 'category'

export interface AdminCanonicalContentDetailInput {
  videoId: string
  videoTitle: string
  languageCode: string
  kind: AdminCanonicalContentKind
  transcriptText?: string | null
  shortSummary?: string | null
  fullSummary?: string | null
  generalCategory?: string | null
  subcategory?: string | null
}

export interface AdminCanonicalContentDetailViewModel {
  videoId: string
  videoTitle: string
  languageCode: string
  kind: AdminCanonicalContentKind
  fields: Array<{ label: string; text: string | null }>
}

export interface AdminCanonicalVideoViewModel {
  id: string
  title: string
  youtubeVideoId: string
  publishedAt: string
  channelTitle: string | null
  languages: string[]
  isAdminEdited: boolean
  transcripts: AdminCanonicalContentLinkViewModel[]
  summaries: AdminCanonicalContentLinkViewModel[]
  categories: AdminCanonicalContentLinkViewModel[]
}

/** Riconosce testo visualizzabile senza alterarne il contenuto originale. */
function hasReadableText(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** Restituisce il testo originale oppure null quando è assente o composto da spazi. */
function presentText(value: string | null | undefined): string | null {
  return hasReadableText(value ?? null) ? value ?? null : null
}

/** Costruisce il link alla sola lingua e sezione che contiene testo già salvato. */
function contentLink(
  videoId: string,
  languageCode: string,
  kind: 'transcript' | 'summary' | 'category',
  hasContent: boolean
): AdminCanonicalContentLinkViewModel {
  return {
    languageCode,
    href: hasContent
      ? `/admin/videos/${encodeURIComponent(videoId)}/content/${kind}/${encodeURIComponent(languageCode)}`
      : null,
  }
}

/** Converte il video admin in link disponibili e indicatori di testo senza serializzare i contenuti. */
export function toAdminCanonicalVideoViewModel(
  video: AdminCanonicalVideoInput
): AdminCanonicalVideoViewModel {
  const localizedByLanguage = new Map(
    video.localizedContent.map((item) => [item.languageCode, item] as const)
  )
  const transcriptsByLanguage = new Map(
    video.transcripts.map((item) => [item.languageCode, item] as const)
  )
  const knownLanguageCodes = Array.from(new Set([
    ...video.localizedContent.map((item) => item.languageCode),
    ...video.transcripts.map((item) => item.languageCode),
  ]))

  return {
    id: video.id,
    title: video.title,
    youtubeVideoId: video.youtubeVideoId,
    publishedAt: video.publishedAt,
    channelTitle: video.channelTitle,
    languages: video.localizedContent.map((item) => item.languageCode),
    isAdminEdited: video.localizedContent.some((item) => item.isAdminEdited),
    transcripts: knownLanguageCodes.map((languageCode) => {
      const transcript = transcriptsByLanguage.get(languageCode)
      return contentLink(
        video.id,
        languageCode,
        'transcript',
        hasReadableText(transcript?.transcriptText ?? null)
      )
    }),
    summaries: knownLanguageCodes.map((languageCode) => {
      const content = localizedByLanguage.get(languageCode)
      return contentLink(
        video.id,
        languageCode,
        'summary',
        hasReadableText(content?.shortSummary ?? null) || hasReadableText(content?.fullSummary ?? null)
      )
    }),
    categories: knownLanguageCodes.map((languageCode) => {
      const content = localizedByLanguage.get(languageCode)
      return contentLink(
        video.id,
        languageCode,
        'category',
        hasReadableText(content?.generalCategory ?? null) || hasReadableText(content?.subcategory ?? null)
      )
    }),
  }
}

/** Converte i campi del contenuto richiesto mantenendo un placeholder per ogni valore vuoto. */
export function toAdminCanonicalContentDetailViewModel(
  content: AdminCanonicalContentDetailInput
): AdminCanonicalContentDetailViewModel {
  const fields = content.kind === 'transcript'
    ? [{ label: 'Trascrizione', text: presentText(content.transcriptText) }]
    : content.kind === 'summary'
      ? [
          { label: 'Riassunto breve', text: presentText(content.shortSummary) },
          { label: 'Riassunto completo', text: presentText(content.fullSummary) },
        ]
      : [
          { label: 'Categoria', text: presentText(content.generalCategory) },
          { label: 'Sottocategoria', text: presentText(content.subcategory) },
        ]

  return {
    videoId: content.videoId,
    videoTitle: content.videoTitle,
    languageCode: content.languageCode,
    kind: content.kind,
    fields,
  }
}
