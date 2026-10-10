/* Commento didattico:
 * Scopo: verifica che la tabella admin mostri link solo per contenuti persistiti e non vuoti.
 * Moduli richiamati: view model contenuto canonico e `vitest`.
 * Flusso: controlla placeholder, separazione linguistica e destinazioni di lettura.
 */

import { describe, expect, it } from 'vitest'
import {
  toAdminCanonicalContentDetailViewModel,
  toAdminCanonicalVideoViewModel,
} from './admin-canonical-content'

describe('admin canonical content view model', () => {
  it('omette i link per valori null, vuoti o whitespace e separa le lingue', () => {
    const video = toAdminCanonicalVideoViewModel({
      id: 'video-1',
      title: 'Titolo prova',
      youtubeVideoId: 'youtube-1',
      publishedAt: '2026-10-10T12:00:00.000Z',
      channelTitle: 'Canale prova',
      localizedContent: [
        {
          languageCode: 'it',
          shortSummary: '   ',
          fullSummary: null,
          generalCategory: 'Scienza',
          subcategory: 'Astronomia',
          isAdminEdited: true,
        },
        {
          languageCode: 'en',
          shortSummary: 'English short',
          fullSummary: 'English full',
          generalCategory: null,
          subcategory: '',
          isAdminEdited: false,
        },
        {
          languageCode: 'fr',
          shortSummary: null,
          fullSummary: '\n ',
          generalCategory: '',
          subcategory: null,
          isAdminEdited: false,
        },
      ],
      transcripts: [
        { languageCode: 'it', transcriptText: '  \n' },
        { languageCode: 'en', transcriptText: 'English transcript' },
        { languageCode: 'unknown', transcriptText: null },
      ],
    })

    expect(video.transcripts).toEqual([
      { languageCode: 'it', href: null },
      { languageCode: 'en', href: '/admin/videos/video-1/content/transcript/en' },
      { languageCode: 'fr', href: null },
      { languageCode: 'unknown', href: null },
    ])
    expect(video.summaries).toEqual([
      { languageCode: 'it', href: null },
      { languageCode: 'en', href: '/admin/videos/video-1/content/summary/en' },
      { languageCode: 'fr', href: null },
      { languageCode: 'unknown', href: null },
    ])
    expect(video.categories).toEqual([
      { languageCode: 'it', href: '/admin/videos/video-1/content/category/it' },
      { languageCode: 'en', href: null },
      { languageCode: 'fr', href: null },
      { languageCode: 'unknown', href: null },
    ])
    expect(JSON.stringify(video)).not.toContain('English transcript')
    expect(JSON.stringify(video)).not.toContain('English full')
  })

  it('lascia le tre colonne al placeholder quando non esistono righe localizzate', () => {
    const video = toAdminCanonicalVideoViewModel({
      id: 'video-2',
      title: 'Senza contenuto',
      youtubeVideoId: 'youtube-2',
      publishedAt: '2026-10-10T12:00:00.000Z',
      channelTitle: null,
      localizedContent: [],
      transcripts: [],
    })

    expect(video.transcripts).toEqual([])
    expect(video.summaries).toEqual([])
    expect(video.categories).toEqual([])
  })

  it('mostra una voce placeholder per la lingua nota solo nei transcript', () => {
    const video = toAdminCanonicalVideoViewModel({
      id: 'video-5',
      title: 'Trascrizione EN e testo IT',
      youtubeVideoId: 'youtube-5',
      publishedAt: '2026-10-10T12:00:00.000Z',
      channelTitle: null,
      localizedContent: [{
        languageCode: 'it',
        shortSummary: 'Riassunto IT',
        fullSummary: null,
        generalCategory: 'Scienza',
        subcategory: null,
        isAdminEdited: false,
      }],
      transcripts: [{ languageCode: 'en', transcriptText: 'Transcript EN' }],
    })

    expect(video.transcripts).toEqual([
      { languageCode: 'it', href: null },
      { languageCode: 'en', href: '/admin/videos/video-5/content/transcript/en' },
    ])
    expect(video.summaries).toEqual([
      { languageCode: 'it', href: '/admin/videos/video-5/content/summary/it' },
      { languageCode: 'en', href: null },
    ])
    expect(video.categories).toEqual([
      { languageCode: 'it', href: '/admin/videos/video-5/content/category/it' },
      { languageCode: 'en', href: null },
    ])
  })

  it('mostra una voce placeholder per la lingua nota solo nel contenuto localizzato', () => {
    const video = toAdminCanonicalVideoViewModel({
      id: 'video-6',
      title: 'Trascrizione IT e testo EN',
      youtubeVideoId: 'youtube-6',
      publishedAt: '2026-10-10T12:00:00.000Z',
      channelTitle: null,
      localizedContent: [{
        languageCode: 'en',
        shortSummary: 'English summary',
        fullSummary: null,
        generalCategory: null,
        subcategory: null,
        isAdminEdited: false,
      }],
      transcripts: [{ languageCode: 'it', transcriptText: 'Trascrizione IT' }],
    })

    expect(video.transcripts).toEqual([
      { languageCode: 'en', href: null },
      { languageCode: 'it', href: '/admin/videos/video-6/content/transcript/it' },
    ])
    expect(video.summaries).toEqual([
      { languageCode: 'en', href: '/admin/videos/video-6/content/summary/en' },
      { languageCode: 'it', href: null },
    ])
    expect(video.categories).toEqual([
      { languageCode: 'en', href: null },
      { languageCode: 'it', href: null },
    ])
  })

  it('mostra i campi canonici separatamente e preserva il testo non vuoto', () => {
    const detail = toAdminCanonicalContentDetailViewModel({
      videoId: 'video-3',
      videoTitle: 'Titolo prova',
      languageCode: 'it',
      kind: 'category',
      generalCategory: '  Scienza  ',
      subcategory: '   ',
    })

    expect(detail.fields).toEqual([
      { label: 'Categoria', text: '  Scienza  ' },
      { label: 'Sottocategoria', text: null },
    ])
  })

  it('restituisce un placeholder per ogni riassunto non compilato', () => {
    const detail = toAdminCanonicalContentDetailViewModel({
      videoId: 'video-4',
      videoTitle: 'Titolo prova',
      languageCode: 'en',
      kind: 'summary',
      shortSummary: null,
      fullSummary: '\n  ',
    })

    expect(detail.fields).toEqual([
      { label: 'Riassunto breve', text: null },
      { label: 'Riassunto completo', text: null },
    ])
  })
})
