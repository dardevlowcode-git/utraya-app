/* Commento didattico:
 * Scopo del file: verifica la resa dell'editor admin del profilo di trascrizione e della pagina che lo alimenta.
 * Moduli richiamati: AdminTranscriptionProfileClient, pagina admin, next-intl e renderer React server-side.
 * Flusso: controlla valori correnti, elenco modelli, stato senza chiave/errore e testi IT/EN.
 */

import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import englishMessages from '../../messages/en.json'
import italianMessages from '../../messages/it.json'
import AdminTranscriptionProfileClient from '../components/admin/AdminTranscriptionProfileClient'

const { getProfileMock, listModelsMock } = vi.hoisted(() => ({ getProfileMock: vi.fn(), listModelsMock: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/services/transcription-profile', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/transcription-profile')>('@/lib/services/transcription-profile')
  return { ...actual, getTranscriptionProfile: getProfileMock, listGeminiModels: listModelsMock }
})

import AdminAiProfilePage from '@/app/(admin)/admin/ai-profile/page'

type Props = Omit<React.ComponentProps<typeof NextIntlClientProvider>, 'children'> & { children?: React.ReactNode }
const Provider = NextIntlClientProvider as React.ComponentType<Props>

const profile = { model: 'gemini-2.5-flash', thinkingLevel: 'low' as const, inputPricePerMillion: 0.3, outputPricePerMillion: 2.5 }
const pricingUrl = 'https://ai.google.dev/gemini-api/docs/pricing'

function render(models: React.ComponentProps<typeof AdminTranscriptionProfileClient>['models'], locale: 'it' | 'en' = 'it') {
  const messages = locale === 'it' ? italianMessages : englishMessages
  return renderToStaticMarkup(createElement(Provider, { locale, messages }, createElement(AdminTranscriptionProfileClient, { profile, models, pricingUrl })))
}

describe('editor profilo di trascrizione', () => {
  it('mostra valori correnti, elenco modelli e link ufficiale prezzi', () => {
    const html = render({ status: 'ok', models: ['gemini-3.1-flash-lite', 'gemini-2.5-flash'] })

    expect(html).toContain('Profilo di trascrizione')
    expect(html).toContain('<option value="gemini-3.1-flash-lite">')
    expect(html).toMatch(/<option value="gemini-2\.5-flash"[^>]*selected/)
    expect(html).toContain('value="0.3"')
    expect(html).toContain('value="2.5"')
    expect(html).toContain(pricingUrl)
    expect(html).not.toContain('disabled=""')
  })

  it('senza chiave Gemini spiega il motivo e blocca solo la scelta del modello', () => {
    const html = render({ status: 'no_key' })

    expect(html).toContain('Nessuna chiave Gemini valida disponibile')
    expect(html).toMatch(/<select id="tp-model"[^>]*disabled/)
    expect(html).not.toMatch(/<select id="tp-level"[^>]*disabled/)
    expect(html).toContain('gemini-2.5-flash')
  })

  it('in errore provider mostra il messaggio in inglese', () => {
    const html = render({ status: 'error' }, 'en')

    expect(html).toContain('Transcription profile')
    expect(html).toContain('Could not read the model list from Google')
  })

  it('la pagina carica profilo ed elenco lato server', async () => {
    getProfileMock.mockResolvedValue(profile)
    listModelsMock.mockResolvedValue({ status: 'no_key' })

    const page = await AdminAiProfilePage()

    expect(page.props).toMatchObject({ profile, models: { status: 'no_key' }, pricingUrl })
  })

  beforeEach(() => vi.clearAllMocks())
})
