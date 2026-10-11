/* Commento didattico:
 * Scopo del file: verifica la resa locale e non segreta della schermata admin retry.
 * Moduli richiamati: AdminRetryLimitsClient, next-intl e renderer React server-side.
 * Flusso: controlla owner, provider, identificatore condiviso inattivo, limiti e massimo tentativi.
 */

import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import englishMessages from '../../messages/en.json'
import italianMessages from '../../messages/it.json'
import AdminRetryLimitsClient from '../components/admin/AdminRetryLimitsClient'
import type { AdminRetryLimitsViewModel } from '@/lib/services/retry-limits'

type Locale = 'en' | 'it'
type TestIntlProviderProps = Omit<React.ComponentProps<typeof NextIntlClientProvider>, 'children'> & {
  children?: React.ReactNode
}
const TestIntlProvider = NextIntlClientProvider as React.ComponentType<TestIntlProviderProps>

const initialRetryLimits: AdminRetryLimitsViewModel = {
  credentials: [
    {
      credentialId: 'credential-id-safe',
      provider: 'gemini',
      owner: 'Owner name',
      isConfigured: true,
      retryLimit: 1,
      maxAttempts: 2,
    },
    {
      credentialId: 'firecrawl-credential-safe',
      provider: 'firecrawl',
      owner: 'Firecrawl owner',
      isConfigured: true,
      retryLimit: 0,
      maxAttempts: 1,
    },
  ],
  sharedYoutube: {
    providerKey: 'youtube_innertube',
    service: 'YouTube Innertube',
    identifier: 'YOUTUBEI_API_KEY',
    retryLimit: 10,
    maxAttempts: 11,
    active: false,
  },
}

/** Renderizza i limiti admin nel locale selezionato. */
function renderRetryLimits(locale: Locale): string {
  const messages = locale === 'it' ? italianMessages : englishMessages
  vi.stubGlobal('React', React)
  return renderToStaticMarkup(createElement(
    TestIntlProvider,
    { locale, messages, timeZone: 'UTC' },
    createElement(AdminRetryLimitsClient, { initialRetryLimits })
  ))
}

afterEach(() => vi.unstubAllGlobals())

describe('AdminRetryLimitsClient', () => {
  it('mostra owner, limite privato, setting shared inattivo e numero tentativi in italiano', () => {
    const html = renderRetryLimits('it')

    expect(html).toContain('Owner name')
    expect(html).toContain('credential-id-safe')
    expect(html).toContain('Firecrawl — Firecrawl owner')
    expect(html).toContain('firecrawl-credential-safe')
    expect(html).toContain('Retry aggiuntivi')
    expect(html).toContain('Massimo tentativi: 2')
    expect(html).toContain('YOUTUBEI_API_KEY')
    expect(html).toContain('Massimo tentativi: 11')
    expect(html).toContain('Pipeline transcript legacy inattiva')
    expect(html).not.toContain('owner@example.test')
    expect(html).not.toContain('encrypted_key')
  })

  it("localizza l'avviso che il limite shared non attiva la pipeline legacy", () => {
    const html = renderRetryLimits('en')

    expect(html).toContain('Additional retries')
    expect(html).toContain('Maximum attempts: 11')
    expect(html).toContain('Legacy transcript pipeline is inactive')
    expect(html).not.toContain('Retry aggiuntivi')
  })

  it('mantiene gli stessi identificatori di messaggio per italiano e inglese', () => {
    expect(Object.keys(italianMessages.admin.retryLimits).sort()).toEqual(
      Object.keys(englishMessages.admin.retryLimits).sort()
    )
  })
})
