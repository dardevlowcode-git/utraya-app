/* Commento didattico:
 * Scopo: verifica il comportamento pubblico della pagina autenticata di utilizzo API.
 * Moduli richiamati: pagina `/usage`, sessione, dashboard, next-intl e Vitest.
 * Flusso: simula i confini server-side e controlla la richiesta della pagina selezionata.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import enMessages from '../../../../messages/en.json'
import itMessages from '../../../../messages/it.json'

const { getCurrentSessionMock, getApiUsageDashboardMock, getLocaleMock, getTranslationsMock, getFormatterMock } = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  getApiUsageDashboardMock: vi.fn(),
  getLocaleMock: vi.fn(),
  getTranslationsMock: vi.fn(),
  getFormatterMock: vi.fn(),
}))

vi.mock('@/lib/auth/provider', () => ({ getCurrentSession: getCurrentSessionMock }))
vi.mock('@/lib/services/api-usage', () => ({ getApiUsageDashboard: getApiUsageDashboardMock }))
vi.mock('next-intl/server', () => ({
  getLocale: getLocaleMock,
  getTranslations: getTranslationsMock,
  getFormatter: getFormatterMock,
}))
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children }: { href: string; children: unknown }) =>
      React.createElement('a', { href }, children as never),
  }
})

import ApiUsagePage, { generateMetadata } from './page'

const emptyDashboard = {
  since: '2026-09-06T00:00:00.000Z',
  page: 1,
  pageSize: 25,
  totalEvents: 0,
  totalPages: 1,
  summaries: [
    { provider: 'gemini', requestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, quotaUnits: 0, unknownUsageCount: 0, usageQuality: 'none' },
    { provider: 'youtube', requestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, quotaUnits: 0, unknownUsageCount: 0, usageQuality: 'none' },
  ],
  events: [],
}

/** Sostituisce i messaggi server-side con stringhe note per il rendering del test. */
function mockTranslations(messages: Record<string, string>) {
  getTranslationsMock.mockResolvedValue((key: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      messages[key] ?? key
    )
  )
}

/** Fornisce formattatori deterministici con la stessa locale usata dai messaggi del test. */
function mockFormatter(locale: string) {
  getFormatterMock.mockResolvedValue({
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, options).format(value),
    dateTime: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, options).format(value),
  })
}

describe('pagina utilizzo API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentSessionMock.mockResolvedValue({
      userId: 'owner-1',
      email: 'owner@example.invalid',
      displayName: null,
      avatarUrl: null,
      role: 'user',
      preferredLanguage: 'it',
    })
    getApiUsageDashboardMock.mockResolvedValue(emptyDashboard)
    getLocaleMock.mockResolvedValue('it')
    mockFormatter('it')
    getTranslationsMock.mockResolvedValue((key: string) => key)
  })

  it('usa la prima pagina se il parametro contiene un intero parziale non valido', async () => {
    await ApiUsagePage({ searchParams: Promise.resolve({ page: '2oops' }) })

    expect(getApiUsageDashboardMock).toHaveBeenCalledWith('owner-1', 1)
  })

  it('non carica né rende il registro senza una sessione autenticata', async () => {
    getCurrentSessionMock.mockResolvedValue(null)

    const page = await ApiUsagePage({ searchParams: Promise.resolve({}) })

    expect(page).toBeNull()
    expect(getApiUsageDashboardMock).not.toHaveBeenCalled()
  })

  it('spiega in italiano lo stato vuoto e l’assenza di storico precedente', async () => {
    mockTranslations({
      'usage.empty': 'Nessuna chiamata registrata in questo periodo.',
      'usage.emptyDetail': 'Il tracciamento inizia con l’attivazione; le chiamate precedenti non sono ricostruibili.',
    })

    const page = await ApiUsagePage({ searchParams: Promise.resolve({}) })
    const html = renderToStaticMarkup(page!)

    expect(html).toContain('Nessuna chiamata registrata in questo periodo.')
    expect(html).toContain('le chiamate precedenti non sono ricostruibili')
  })

  it('mostra riepiloghi, dettagli e link alla pagina successiva senza renderizzare payload', async () => {
    const sensitiveValue = 'page-test-private-payload'
    mockTranslations({
      'usage.title': 'API usage',
      'usage.subtitle': 'Requests from personal API keys over the last 30 days.',
      'usage.gemini': 'Gemini',
      'usage.tokens': 'tokens',
      'usage.inputTokens': 'Input tokens',
      'usage.outputTokens': 'Output tokens',
      'usage.requests': 'requests',
      'usage.estimatedCost': 'Estimated cost',
      'usage.costNote': 'Estimated cost, not an invoice.',
      'usage.youtube': 'YouTube Data API',
      'usage.quotaUnits': 'Estimated quota units',
      'usage.quotaNote': 'Quota units are estimates.',
      'usage.recent': 'Recent requests',
      'usage.manageKeys': 'Manage API keys',
      'usage.date': 'Date (UTC)',
      'usage.providerMethod': 'Provider / method',
      'usage.result': 'Result',
      'usage.consumption': 'Usage',
      'usage.estimate': 'Estimate',
      'usage.page': 'Page {current} of {total} · {count} requests',
      'usage.next': 'Next',
      'usage.previous': 'Previous',
      'usage.privacyNote': 'Only safe request metadata is shown.',
      'usage.success': 'Success',
      'usage.networkError': 'Network error',
      'usage.timeout': 'Timeout',
      'usage.quotaUnitsShort': 'quota units',
      'usage.searchBucket': 'search',
      'usage.tokenUnavailable': 'Tokens unavailable',
    })
    getLocaleMock.mockResolvedValue('en')
    mockFormatter('en')
    getCurrentSessionMock.mockResolvedValue({
      userId: 'owner-1',
      email: 'owner@example.invalid',
      displayName: null,
      avatarUrl: null,
      role: 'user',
      preferredLanguage: 'en',
    })
    getApiUsageDashboardMock.mockResolvedValue({
      ...emptyDashboard,
      totalEvents: 26,
      totalPages: 2,
      summaries: [
        { provider: 'gemini', requestCount: 2, inputTokens: 1_000, outputTokens: 250, totalTokens: 1_250, estimatedCostUsd: 0.000925, quotaUnits: 0, unknownUsageCount: 0, usageQuality: 'recorded' },
        { provider: 'youtube', requestCount: 26, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, quotaUnits: 30, unknownUsageCount: 0, usageQuality: 'recorded' },
      ],
      events: [{
        id: 'event-1',
        provider: 'youtube',
        operation: 'search.list',
        occurredAt: '2026-10-05T12:00:00.000Z',
        outcome: 'http_error',
        httpStatus: 503,
        errorCategory: 'provider_error',
        model: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
        quotaUnits: 100,
        quotaBucket: 'search',
        api_key: sensitiveValue,
        prompt: sensitiveValue,
        response_body: sensitiveValue,
        request_url: `https://provider.example.invalid/?key=${sensitiveValue}`,
      } as never],
    })

    const page = await ApiUsagePage({ searchParams: Promise.resolve({ page: '1' }) })
    const html = renderToStaticMarkup(page!)

    expect(html).toContain('API usage')
    expect(html).toContain('1,250')
    expect(html).toContain('$0.000925')
    expect(html).toContain('HTTP 503')
    expect(html).toContain('search.list')
    expect(html).toContain('100 quota units · search')
    expect(html).toContain('Page 1 of 2 · 26 requests')
    expect(html).toContain('href="/usage?page=2"')
    expect(html).not.toContain(sensitiveValue)
  })

  it('mostra pagina 2 con solo il collegamento alla pagina precedente dopo il clamp', async () => {
    mockTranslations({
      'usage.title': 'Utilizzo API',
      'usage.subtitle': 'Chiamate degli ultimi 30 giorni.',
      'usage.page': 'Pagina {current} di {total} · {count} chiamate',
      'usage.previous': 'Precedente',
      'usage.next': 'Successiva',
    })
    getApiUsageDashboardMock.mockResolvedValue({
      ...emptyDashboard,
      page: 2,
      totalEvents: 26,
      totalPages: 2,
      events: [],
    })

    const page = await ApiUsagePage({ searchParams: Promise.resolve({ page: '999' }) })
    const html = renderToStaticMarkup(page!)

    expect(getApiUsageDashboardMock).toHaveBeenCalledWith('owner-1', 999)
    expect(html).toContain('Pagina 2 di 2 · 26 chiamate')
    expect(html).toContain('href="/usage?page=1"')
    expect(html).not.toContain('href="/usage?page=3"')
    expect(html).not.toContain('>Successiva<')
  })

  it('localizza titolo e descrizione della pagina in inglese', async () => {
    getTranslationsMock.mockResolvedValue((key: string) => ({
      title: 'API usage',
      subtitle: 'Requests made with your personal API keys during the last 30 days.',
    })[key as 'title' | 'subtitle'] ?? key)

    const metadata = await generateMetadata()

    expect(metadata).toMatchObject({
      title: 'API usage',
      description: 'Requests made with your personal API keys during the last 30 days.',
    })
  })

  it('mostra in italiano e inglese un avviso best-effort senza promettere gli eventi persi', async () => {
    const cases = [
      { locale: 'it', messages: itMessages },
      { locale: 'en', messages: enMessages },
    ]

    for (const { locale, messages } of cases) {
      const warning = messages.usage.bestEffortWarning
      mockFormatter(locale)
      mockTranslations(Object.fromEntries(
        Object.entries(messages.usage).map(([key, value]) => [`usage.${key}`, value])
      ))

      const page = await ApiUsagePage({ searchParams: Promise.resolve({}) })
      const html = renderToStaticMarkup(page!)

      expect(html).toContain(warning)
    }
  })

  it('mostra gli aggregati Gemini ignoti come non disponibili, non come zero', async () => {
    mockTranslations({
      'usage.title': 'API usage',
      'usage.subtitle': 'Requests from personal keys.',
      'usage.notAvailable': 'Not available',
      'usage.summaryUnknown': 'Usage metadata is unavailable for {count} recorded requests.',
    })
    getApiUsageDashboardMock.mockResolvedValue({
      ...emptyDashboard,
      totalEvents: 2,
      summaries: [
        {
          provider: 'gemini',
          requestCount: 2,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          estimatedCostUsd: null,
          quotaUnits: null,
          unknownUsageCount: 2,
          usageQuality: 'unknown',
        },
        emptyDashboard.summaries[1],
      ],
    })

    const page = await ApiUsagePage({ searchParams: Promise.resolve({}) })
    const html = renderToStaticMarkup(page!)

    expect(html).toContain('Usage metadata is unavailable for 2 recorded requests.')
    expect(html).toContain('Not available')
    expect(html).not.toContain('$0.000000')
  })

  it('indica aggregati parziali e mostra il total token restituito dal provider', async () => {
    mockTranslations({
      'usage.title': 'API usage',
      'usage.subtitle': 'Requests from personal keys.',
      'usage.tokens': 'tokens',
      'usage.totalTokens': 'Total tokens',
      'usage.inputTokens': 'Input tokens',
      'usage.outputTokens': 'Output tokens',
      'usage.requests': 'requests',
      'usage.estimatedCost': 'Estimated cost',
      'usage.costNote': 'Estimated cost, not an invoice.',
      'usage.youtube': 'YouTube Data API',
      'usage.quotaUnits': 'Estimated quota units',
      'usage.quotaNote': 'Quota units are estimates.',
      'usage.notAvailable': 'Not available',
      'usage.summaryPartial': 'Partial totals: usage metadata is missing for {count} recorded requests.',
    })
    mockFormatter('en')
    getApiUsageDashboardMock.mockResolvedValue({
      ...emptyDashboard,
      totalEvents: 2,
      summaries: [
        {
          provider: 'gemini',
          requestCount: 2,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 123,
          estimatedCostUsd: 0.00008,
          quotaUnits: null,
          unknownUsageCount: 1,
          usageQuality: 'partial',
        },
        emptyDashboard.summaries[1],
      ],
    })

    const page = await ApiUsagePage({ searchParams: Promise.resolve({}) })
    const html = renderToStaticMarkup(page!)

    expect(html).toContain('123')
    expect(html).toContain('Partial totals: usage metadata is missing for 1 recorded requests.')
    expect(html).toContain('$0.000080')
  })
})
