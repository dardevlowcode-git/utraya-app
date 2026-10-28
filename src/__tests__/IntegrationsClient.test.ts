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
import type { CredentialStatus } from '@/lib/types/domain'
import englishMessages from '../../messages/en.json'
import italianMessages from '../../messages/it.json'
import IntegrationsClient from '../app/(private)/integrations/IntegrationsClient'

type Locale = 'en' | 'it'
type TestIntlProviderProps = Omit<React.ComponentProps<typeof NextIntlClientProvider>, 'children'> & {
  children?: React.ReactNode
}
const TestIntlProvider = NextIntlClientProvider as React.ComponentType<TestIntlProviderProps>

/** Renderizza la schermata integrazioni con i messaggi del locale scelto. */
function renderIntegrations(locale: Locale, initialStatuses: CredentialStatus[] = []): string {
  const messages = locale === 'it' ? italianMessages : englishMessages
  vi.stubGlobal('React', React)

  return renderToStaticMarkup(createElement(
    TestIntlProvider,
    { locale, messages, timeZone: 'UTC' },
    createElement(IntegrationsClient, { initialStatuses })
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
    expect(html).toContain('accoda una verifica')
    expect(html).not.toContain('la verifica subito con una richiesta API')
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

  it('rende la guida YouTube in inglese senza confonderla con quella Gemini', () => {
    const html = renderIntegrations('en')

    expect((html.match(/<details/g) ?? [])).toHaveLength(2)
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
    expect(html).toContain('queues a verification')
    expect(html).not.toContain('immediately checks it with an API request')
    expect(html).toContain('lg:flex-row')
    expect(html).toContain('flex-col')
    expect(html).toContain('w-full')
    expect(html).not.toContain('Crea o seleziona un progetto Google Cloud')
    expect(html).not.toContain('Credenziali')
    expect(html).not.toContain('integrations.youtubeKey')
    expect(html).toContain('How to get and configure a Gemini API key')
    expect(html).not.toContain('Come ottenere e configurare una chiave Gemini API')
    expect(html).toContain('Save key')
    const englishPasswordInput = html.match(/<input\b[^>]*type="password"[^>]*>/)?.[0] ?? ''
    expect(englishPasswordInput).toContain('aria-label="YouTube Data API v3: Paste your API key here"')
    expect(englishPasswordInput).toContain('text-base')
    expect(englishPasswordInput.toLowerCase()).toContain('inputmode="text"')
    expect(englishPasswordInput.toLowerCase()).toContain('autocomplete="off"')
    expect(englishPasswordInput.toLowerCase()).toContain('enterkeyhint="done"')
  })

  it('mostra uno stato pending anche se la verifica precedente era valida', () => {
    const status: CredentialStatus = {
      provider: 'youtube',
      isConfigured: true,
      isValid: true,
      validationStatus: 'pending',
      lastValidatedAt: null,
      lastUsedAt: null,
      lastError: null,
      maskedKey: '****1234',
    }

    const italian = renderIntegrations('it', [status])
    const english = renderIntegrations('en', [status])

    expect(italian).toContain('Verifica in corso')
    expect(english).toContain('Checking')
    expect(italianMessages.integrations.validationPending).toContain('verifica in corso')
    expect(englishMessages.integrations.validationPending).toContain('verification is continuing in the background')
  })

})

describe('IntegrationsClient Gemini setup guide', () => {
  it('mostra in italiano una disclosure nativa, accessibile da tastiera e adatta al mobile con link AI Studio', () => {
    const html = renderIntegrations('it')
    const geminiGuide = [...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)]
      .map(([markup]) => markup)
      .find((markup) => markup.includes('Come ottenere e configurare una chiave Gemini API')) ?? ''
    const summary = geminiGuide.match(/<summary\b[^>]*>/)?.[0] ?? ''
    const guideLinks = [...geminiGuide.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag)

    expect(geminiGuide).not.toBe('')
    expect(geminiGuide).not.toMatch(/<details[^>]*\sopen(?:[=>\s])/)
    expect(geminiGuide).toContain('https://aistudio.google.com/api-keys')
    expect(summary).toContain('min-h-11')
    expect(summary).toContain('focus-visible:ring-2')
    expect(summary).not.toContain('role="button"')
    expect(geminiGuide).toContain('flex flex-wrap')
    expect(geminiGuide).toContain('w-full')
    expect(guideLinks.length).toBeGreaterThan(0)
    expect(guideLinks.every((tag) => tag.includes('min-h-11'))).toBe(true)
  })

  it('distingue in italiano Free e Paid, privacy, costo e vincoli SEE con fonti ufficiali', () => {
    const html = renderIntegrations('it')
    const geminiGuide = [...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)]
      .map(([markup]) => markup)
      .find((markup) => markup.includes('Come ottenere e configurare una chiave Gemini API')) ?? ''

    expect(geminiGuide).toContain('Free Tier è disponibile solo per alcuni modelli')
    expect(geminiGuide).toContain('Paid Tier richiede di collegare un account Google Cloud Billing')
    expect(geminiGuide).toContain('abbonamento non paga automaticamente')
    expect(geminiGuide).toContain('SEE, Svizzera e Regno Unito solo usando Paid Services')
    expect(geminiGuide).toContain('revisori umani potrebbero leggerli o annotarli')
    expect(geminiGuide).toContain('possono comunque essere conservati per un periodo limitato')
    expect(geminiGuide).toContain('https://ai.google.dev/gemini-api/docs/billing')
    expect(geminiGuide).toContain('https://ai.google.dev/gemini-api/docs/rate-limits')
    expect(geminiGuide).toContain('https://ai.google.dev/gemini-api/docs/pricing')
    expect(geminiGuide).toContain('https://ai.google.dev/gemini-api/terms')
    expect(geminiGuide).toContain('https://ai.google.dev/gemini-api/docs/available-regions')
    expect(geminiGuide).toContain('non abilita un nuovo generatore permanente')
  })

  it('rende in inglese gli stessi avvisi su Free/Paid, territori e privacy', () => {
    const html = renderIntegrations('en')
    const geminiGuide = [...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)]
      .map(([markup]) => markup)
      .find((markup) => markup.includes('How to get and configure a Gemini API key')) ?? ''

    expect(geminiGuide).toContain('Free Tier is available only for some models')
    expect(geminiGuide).toContain('Paid Tier requires linking a Google Cloud Billing account')
    expect(geminiGuide).toContain('only on Paid Services')
    expect(geminiGuide).toContain('human reviewers may read or annotate them')
    expect(geminiGuide).toContain('may still be retained for a limited period')
    expect(geminiGuide).toContain('does not enable a new permanent generator')
    expect(geminiGuide).not.toContain('SEE, Svizzera e Regno Unito')
  })
})
