import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import englishMessages from '../../messages/en.json'
import italianMessages from '../../messages/it.json'
import AdminTranscriptionsClient, { type AdminTranscriptionsProps } from '../components/admin/AdminTranscriptionsClient'

const { listMock, statsMock } = vi.hoisted(() => ({ listMock: vi.fn(), statsMock: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/services/admin-transcriptions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/admin-transcriptions')>('@/lib/services/admin-transcriptions')
  return { ...actual, listAdminTranscriptions: listMock, getAdminReviewStats: statsMock }
})

import AdminTranscriptionsPage from '@/app/(admin)/admin/transcriptions/page'

type Props = Omit<React.ComponentProps<typeof NextIntlClientProvider>, 'children'> & { children?: React.ReactNode }
const Provider = NextIntlClientProvider as React.ComponentType<Props>

const stats: AdminTranscriptionsProps['stats'] = [
  { days: 7, counts: { pending: 0, running: 1, complete: 3, needs_review: 1, unavailable: 0 }, finished: 4, needsReviewPercent: 25, averageDoubtfulPhrases: 1.5 },
  { days: 30, counts: { pending: 0, running: 0, complete: 0, needs_review: 0, unavailable: 0 }, finished: 0, needsReviewPercent: null, averageDoubtfulPhrases: null },
]
const props: AdminTranscriptionsProps = {
  filter: 'needs_review',
  filters: ['needs_review', 'pending', 'running', 'complete', 'unavailable', 'all'],
  page: 2,
  pageCount: 3,
  total: 60,
  stats,
  items: [{
    id: 't1', status: 'needs_review', videoTitle: 'Video sintetico', channelTitle: 'Canale', appVideoHref: '/video/v1',
    youtubeUrl: 'https://www.youtube.com/watch?v=abc&t=0s', model: 'gemini-3.1-flash-lite', thinkingLevel: 'minimal',
    phraseCount: 88, doubtfulPhraseCount: 4,
    missingParts: [{ position: 1, interval: '2:00–4:00', lastError: 'provider_http_503' }],
    referenceDate: '2026-10-18T10:00:00Z', canRelaunch: true,
  }],
}

function render(overrides: Partial<AdminTranscriptionsProps> = {}, locale: 'it' | 'en' = 'it') {
  const messages = locale === 'it' ? italianMessages : englishMessages
  return renderToStaticMarkup(createElement(Provider, { locale, messages }, createElement(AdminTranscriptionsClient, { ...props, ...overrides })))
}

describe('pagina admin trascrizioni', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mostra filtri con quello attivo, frequenza 7/30 giorni e dati della trascrizione', () => {
    const html = render()

    expect(html).toContain('Trascrizioni')
    expect(html).toMatch(/href="\/admin\/transcriptions\?status=needs_review"[^>]*aria-current="page"/)
    expect(html).toContain('href="/admin/transcriptions?status=all"')
    expect(html).toContain('Ultimi 7 giorni')
    expect(html).toContain('Da rivedere: 25%')
    expect(html).toContain('Frasi dubbie in media: 1.5')
    expect(html).toContain('Da rivedere: nessuna trascrizione conclusa')
    expect(html).toContain('Video sintetico')
    expect(html).toContain('href="/video/v1"')
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc&amp;t=0s"')
    expect(html).toContain('gemini-3.1-flash-lite')
    expect(html).toContain('>88<')
    expect(html).toContain('2:00–4:00')
    expect(html).toContain('provider_http_503')
    expect(html).toContain('Rilancia questa parte')
    expect(html).toContain('Rilancia parti mancanti')
  })

  it('paginazione con precedente e successiva che conservano il filtro', () => {
    const html = render()

    expect(html).toContain('Pagina 2 di 3')
    expect(html).toContain('href="/admin/transcriptions?status=needs_review"')
    expect(html).toContain('href="/admin/transcriptions?status=needs_review&amp;page=3"')
  })

  it('elenco vuoto: messaggio e nessun pulsante di rilancio', () => {
    const html = render({ items: [], total: 0, page: 1, pageCount: 1 })

    expect(html).toContain('Nessuna trascrizione per questo filtro.')
    expect(html).not.toContain('Rilancia')
  })

  it('senza parti mancanti non offre il rilancio', () => {
    const html = render({ items: [{ ...props.items[0], missingParts: [], canRelaunch: false }] })

    expect(html).toContain('Nessuna parte mancante')
    expect(html).not.toContain('Rilancia')
  })

  it('testi in inglese', () => {
    const html = render({}, 'en')

    expect(html).toContain('Review frequency')
    expect(html).toContain('Needs review: 25%')
    expect(html).toContain('Relaunch missing parts')
  })

  it('la pagina valida i parametri e ripiega su "da rivedere", pagina 1', async () => {
    listMock.mockResolvedValue({ filter: 'needs_review', page: 1, pageCount: 1, total: 0, items: [] })
    statsMock.mockResolvedValue(stats)

    await AdminTranscriptionsPage({ searchParams: Promise.resolve({ status: 'bogus', page: '-4' }) })

    expect(listMock).toHaveBeenCalledWith({}, { filter: 'needs_review', page: 1 })
  })

  it('la pagina passa filtro e pagina validi al servizio', async () => {
    listMock.mockResolvedValue({ filter: 'running', page: 3, pageCount: 3, total: 60, items: [] })
    statsMock.mockResolvedValue(stats)

    const page = await AdminTranscriptionsPage({ searchParams: Promise.resolve({ status: 'running', page: '3' }) })

    expect(listMock).toHaveBeenCalledWith({}, { filter: 'running', page: 3 })
    expect(page.props).toMatchObject({ filter: 'running', page: 3, pageCount: 3, stats })
  })
})
