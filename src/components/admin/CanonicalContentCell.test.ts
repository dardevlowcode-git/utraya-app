/* Commento didattico:
 * Scopo: verifica che la tabella admin renda link solo per le lingue con testo disponibile.
 * Moduli richiamati: cella contenuto canonico, React SSR e `vitest`.
 * Flusso: controlla link accessibili, placeholder «—» e varianti linguistiche.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CanonicalContentCell from './CanonicalContentCell'

describe('CanonicalContentCell', () => {
  it('distingue le lingue e non rende cliccabili i contenuti mancanti', () => {
    const markup = renderToStaticMarkup(createElement(CanonicalContentCell, {
      label: 'Trascrizione',
      items: [
        { languageCode: 'it', href: null },
        { languageCode: 'en', href: '/admin/videos/video-1/content/transcript/en' },
      ],
    }))

    expect(markup).toContain('IT: —')
    expect(markup).toContain('href="/admin/videos/video-1/content/transcript/en"')
    expect(markup).toContain('aria-label="Trascrizione (EN)"')
    expect(markup).not.toContain('href="/admin/videos/video-1/content/transcript/it"')
  })

  it('mostra il trattino quando non ci sono varianti per la sezione', () => {
    const markup = renderToStaticMarkup(createElement(CanonicalContentCell, {
      label: 'Categorie',
      items: [],
    }))

    expect(markup).toContain('—')
    expect(markup).not.toContain('<a')
  })
})
