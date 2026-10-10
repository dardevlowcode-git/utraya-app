/* Commento didattico:
 * Scopo del file: verifica che la guida YouTube sia localizzata e collegata al connettore corretto.
 * Moduli richiamati: `IntegrationsClient`, provider `next-intl` e renderer React server-side.
 * Flusso: renderizza la schermata pubblica e controlla semantica della disclosure, fonti e form chiave.
 */

import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import englishMessages from '../../messages/en.json'
import italianMessages from '../../messages/it.json'
import IntegrationsClient from '../app/(private)/integrations/IntegrationsClient'

type Locale = 'en' | 'it'
type TestIntlProviderProps = Omit<React.ComponentProps<typeof NextIntlClientProvider>, 'children'> & {
  children?: React.ReactNode
}
const TestIntlProvider = NextIntlClientProvider as React.ComponentType<TestIntlProviderProps>

/** Renderizza la schermata integrazioni con i messaggi del locale scelto. */
function renderIntegrations(locale: Locale): string {
  const messages = locale === 'it' ? italianMessages : englishMessages
  vi.stubGlobal('React', React)

  return renderToStaticMarkup(createElement(
    TestIntlProvider,
    { locale, messages, timeZone: 'UTC' },
    createElement(IntegrationsClient, { initialStatuses: [] })
  ))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IntegrationsClient YouTube setup guide', () => {
  it('mostra una guida nativa collassata con passaggi, link ufficiali e form chiave in italiano', () => {
    const html = renderIntegrations('it')

    expect(html).toContain('<details')
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[=>\s])/)
    expect(html).toContain('<summary')
    expect(html).toContain('focus-visible:ring-2')
    expect(html).toContain('min-h-11')
    expect(html).toContain('py-2')
    expect(html).toContain('rounded-md bg-primary-fixed/40 p-4')
    expect(html).toContain('Crea o seleziona un progetto Google Cloud')
    expect(html).toContain('YouTube Data API v3')
    expect(html).toContain('OAuth')
    expect(html).toContain('devi aggiungere almeno una restrizione API')
    expect(html).toContain('selezionare esclusivamente YouTube Data API v3 prima di scegliere Crea')
    expect(html).toContain('richiede questa restrizione per generare la chiave')
    const italianTroubleshooting = html.match(
      /<section aria-labelledby="youtube-guide-troubleshooting-title">([\s\S]*?)<\/section>/
    )?.[1] ?? ''
    expect(italianTroubleshooting).toContain('restrizione API includa YouTube Data API v3')
    expect(italianTroubleshooting).not.toContain('API restriction')
    expect(html).not.toContain('Se richiesto')
    expect(html).not.toContain("se non l'hai impostata durante la creazione")
    expect(html).toContain('https://console.cloud.google.com/apis/credentials')
    expect(html).toContain('target="_blank" rel="noreferrer"')
    expect(html).toContain('search.list')
    expect(html).toContain('100 richieste search.list')
    expect(html).toContain('10.000 unità al giorno')
    expect(html).toContain('non pubblica qui un prezzo in denaro per richiesta')
    expect(html).toContain('lg:flex-row')
    expect(html).toContain('flex-col')
    expect(html).toContain('w-full')
    expect(html).toContain('Incolla la tua chiave API qui')
    const italianPasswordInput = html.match(/<input\b[^>]*type="password"[^>]*>/)?.[0] ?? ''
    expect(italianPasswordInput).toContain('aria-label="YouTube Data API v3: Incolla la tua chiave API qui"')
    expect(italianPasswordInput).toContain('text-base')
    expect(italianPasswordInput).toContain('focus-visible:ring-2')
    expect(italianPasswordInput.toLowerCase()).toContain('inputmode="text"')
    expect(italianPasswordInput.toLowerCase()).toContain('autocomplete="off"')
    expect(italianPasswordInput.toLowerCase()).toContain('enterkeyhint="done"')
    const saveButton = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0] ?? ''
    expect(saveButton).toContain('min-h-11')
    const guideLinks = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag)
    expect(guideLinks.length).toBeGreaterThan(0)
    expect(guideLinks.every((tag) => tag.includes('min-h-11'))).toBe(true)
    expect(html).not.toContain('<img')
  })

  it('rende contenuti coerenti in inglese e non mostra una copia della guida nel card Gemini', () => {
    const html = renderIntegrations('en')

    expect((html.match(/<details/g) ?? [])).toHaveLength(1)
    expect(html).toContain('Create or select a Google Cloud project')
    expect(html).toContain('HTTP referrers')
    expect(html).toContain('API key')
    expect(html).toContain('you must add at least one API restriction')
    expect(html).toContain('select only YouTube Data API v3 before choosing Create')
    expect(html).toContain('requires this restriction before creating the key')
    expect(html).not.toContain('If prompted')
    expect(html).not.toContain('if you did not set this while creating the key')
    expect(html).toContain('100 search.list requests per day')
    expect(html).toContain('10,000 units per day')
    expect(html).toContain('does not publish a dollar price')
    expect(html).toContain('lg:flex-row')
    expect(html).toContain('flex-col')
    expect(html).toContain('w-full')
    expect(html).not.toContain('Crea o seleziona un progetto Google Cloud')
    expect(html).not.toContain('Credenziali')
    expect(html).not.toContain('integrations.youtubeKey')
    expect(html).toContain('Save key')
    const englishPasswordInput = html.match(/<input\b[^>]*type="password"[^>]*>/)?.[0] ?? ''
    expect(englishPasswordInput).toContain('aria-label="YouTube Data API v3: Paste your API key here"')
    expect(englishPasswordInput).toContain('text-base')
    expect(englishPasswordInput.toLowerCase()).toContain('inputmode="text"')
    expect(englishPasswordInput.toLowerCase()).toContain('autocomplete="off"')
    expect(englishPasswordInput.toLowerCase()).toContain('enterkeyhint="done"')
  })

  it('fornisce lo stesso insieme di traduzioni per la guida nei due locali', () => {
    expect(Object.keys(italianMessages.integrations.youtubeGuide).sort()).toEqual(
      Object.keys(englishMessages.integrations.youtubeGuide).sort()
    )
  })
})
