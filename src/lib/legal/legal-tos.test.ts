import * as React from 'react'
import { createElement } from 'react'
import { readFileSync, readdirSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { hashLegalDocument, hashLegalDocumentContent, toPublicTosMarkdown } from '@/lib/legal/hashLegalDocument'
import { TOS_REQUIRED_HASH, TOS_REQUIRED_VERSION } from '@/lib/legal/required'
import { loadLegalDocument } from '@/lib/legal/documents'
import LegalMarkdownDocument from '@/components/legal/LegalMarkdownDocument'
import englishMessages from '../../../messages/en.json'
import italianMessages from '../../../messages/it.json'

type Locale = 'en' | 'it'
type TestIntlProviderProps = Omit<React.ComponentProps<typeof NextIntlClientProvider>, 'children'> & {
  children?: React.ReactNode
}
const TestIntlProvider = NextIntlClientProvider as React.ComponentType<TestIntlProviderProps>

function renderLegalDocument(locale: Locale, document: Awaited<ReturnType<typeof loadLegalDocument>>): string {
  return renderToStaticMarkup(createElement(
    TestIntlProvider,
    { locale, messages: locale === 'it' ? italianMessages : englishMessages, timeZone: 'UTC' },
    createElement(LegalMarkdownDocument, document)
  ))
}

const APPROVED_ITALIAN_SECTION_8 =
  "Inserendo e salvando una chiave API personale, l'utente ne abilita l'utilizzo automatico da parte di Utraya per le funzionalità associate al servizio. Per elaborare i contenuti di un canale, Utraya può utilizzare una delle chiavi idonee degli utenti che seguono quel canale, alternandole separatamente per canale e fornitore. Il consumo viene attribuito dal fornitore all'account o al team associato alla chiave utilizzata, secondo il relativo piano e le condizioni applicabili. L'alternanza riguarda i lavori assegnati e non garantisce consumi o costi uguali. I risultati già disponibili vengono riutilizzati senza ripetere l'elaborazione. Rimuovendo la chiave, questa viene esclusa dalle nuove assegnazioni."

const APPROVED_ITALIAN_SECTION_9 =
  'Eventuali consumi, limiti e costi dei servizi esterni sono distinti da quelli di Utraya e dipendono dalle condizioni del relativo fornitore.'

const APPROVED_ENGLISH_SECTION_8 =
  "By entering and saving a personal API key, the user enables Utraya to use it automatically for the features associated with the service. To process a channel's content, Utraya may use one of the eligible keys belonging to users who follow that channel, alternating them separately by channel and provider. The provider attributes usage to the account or team associated with the key used, according to the applicable plan and terms. Alternation applies to assigned jobs and does not guarantee equal usage or costs. Results already available are reused without repeating processing. Removing the key excludes it from new assignments."

const APPROVED_ENGLISH_SECTION_9 =
  "Any usage, limits, and costs of external services are separate from those of Utraya and depend on the applicable provider's terms."

describe('legal TOS document', () => {
  it('allinea la versione TOS SQL più recente alla versione richiesta dall’app', () => {
    const migrationFiles = readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort()
    const definitions: string[] = []
    const definitionPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.required_tos_version\s*\(\s*\)[\s\S]*?\bAS\s+\$\$([\s\S]*?)\$\$/gi

    for (const file of migrationFiles) {
      const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
      for (const match of sql.matchAll(definitionPattern)) definitions.push(match[1])
    }

    const latestDefinition = definitions.at(-1)
    expect(latestDefinition).toBeDefined()
    const returnedVersion = latestDefinition?.match(/\bSELECT\s+'([^']+)'(?:\s*::\s*TEXT)?\s*;?\s*$/i)?.[1]
    expect(returnedVersion).toBe(TOS_REQUIRED_VERSION)
  })

  it('serves the required version with a hash matching the document', async () => {
    const document = await loadLegalDocument('tos')

    expect(document.version).toBe(TOS_REQUIRED_VERSION)
    expect(document.hash).toBe(TOS_REQUIRED_HASH)
    expect(TOS_REQUIRED_VERSION).toBe('2026-10-25-1')
    expect(document.markdown).not.toContain('Stato**: candidata locale')
    expect(document.markdown).not.toContain('Versione pubblicata/efficace**: non verificata')
    expect(document.markdown).not.toContain('Data di entrata in vigore della candidata**:')
    expect(document.markdown).not.toContain('✅ versione pubblicata')
    expect(document.markdown).not.toContain('Data di entrata in vigore**: 2026-10-11')
    expect(document.effectiveDate).toBe('non determinata')
  })

  it('non presenta una data candidata non determinata come data di efficacia', async () => {
    const document = await loadLegalDocument('tos')
    const italianHtml = renderLegalDocument('it', document)
    const englishHtml = renderLegalDocument('en', document)

    expect(italianHtml).toContain('Data di entrata in vigore: non determinata')
    expect(italianHtml).not.toContain('In vigore dal non determinata')
    expect(englishHtml).toContain('Effective date: not determined')
    expect(englishHtml).not.toContain('non determinata')
  })

  it('localizza l’etichetta di efficacia per le date determinate in italiano e inglese', async () => {
    const document = await loadLegalDocument('tos')
    const datedDocument = { ...document, effectiveDate: '2026-10-11' }

    expect(renderLegalDocument('it', datedDocument)).toContain('In vigore dal 11 ottobre 2026')
    expect(renderLegalDocument('en', datedDocument)).toContain('Effective as of October 11, 2026')
    expect(renderLegalDocument('en', document)).toContain('Effective date: not determined')
  })

  it('localizza le etichette di versione e hash documento in italiano e inglese', async () => {
    const document = await loadLegalDocument('tos')

    expect(renderLegalDocument('it', document)).toContain('Versione 2026-10-25-1')
    expect(renderLegalDocument('it', document)).toContain('Hash documento: a180e26c76c73721… (SHA-256)')
    expect(renderLegalDocument('en', document)).toContain('Version 2026-10-25-1')
    expect(renderLegalDocument('en', document)).toContain('Document hash: a180e26c76c73721… (SHA-256)')
  })

  it('mantiene le note §0 nella fonte ma le esclude dal documento pubblico renderizzato', async () => {
    const source = readFileSync('src/content/legal/legal-tos.md', 'utf8')
    const document = await loadLegalDocument('tos')

    expect(source).toContain('## 0. Note operative')
    expect(source).toContain('sulla rappresentazione Markdown canonica mostrata')
    expect(document.markdown).not.toContain('## 0. Note operative')
    expect(document.markdown).not.toContain('sulla rappresentazione Markdown canonica mostrata')
    expect(document.markdown).toContain('## 1. Preambolo e natura del servizio')
    expect(document.hash).toBe(TOS_REQUIRED_HASH)
    expect(document.markdown).not.toContain('Sintesi giuridica (non parte del TOS pubblico)')
  })

  it('calcola hash e accettazione dalla stessa rappresentazione Markdown pubblica', async () => {
    const document = await loadLegalDocument('tos')
    const source = readFileSync('src/content/legal/legal-tos.md', 'utf8')
    const publicMarkdown = toPublicTosMarkdown(source)

    expect(publicMarkdown).toBe(`# ${document.title}\n\n${document.markdown}`)
    expect(document.hash).toBe(hashLegalDocumentContent(publicMarkdown))
    expect(hashLegalDocument('src/content/legal/legal-tos.md')).toBe(document.hash)
    expect(document.hash).not.toBe(hashLegalDocumentContent(source))

    const internalNoteRevision = source
      .replace('candidata locale `2026-10-25-1`; questa copia non attesta pubblicazione né efficacia online.', 'metadata locale aggiornato solo internamente.')
      .replace('Modifiche alle sole note interne non cambiano hash né richiedono nuova accettazione.', 'Nota operativa interna aggiornata.')
    expect(toPublicTosMarkdown(internalNoteRevision)).toBe(publicMarkdown)

    const changedPublicClause = source.replace(
      "L'utilizzo del servizio è **volontario**.",
      "L'utilizzo del servizio è **facoltativo**."
    )
    expect(hashLegalDocumentContent(toPublicTosMarkdown(changedPublicClause))).not.toBe(document.hash)
  })

  it('includes the exact approved Italian wording and Firecrawl provider row', async () => {
    const document = await loadLegalDocument('tos')

    expect(document.markdown).toContain(APPROVED_ITALIAN_SECTION_8)
    expect(document.markdown).toContain(APPROVED_ITALIAN_SECTION_9)
    expect(document.markdown).toContain('| Firecrawl | Conservazione e verifica della chiave personale Firecrawl | Chiave API (nessuna trascrizione recuperata) |')
  })

  it('includes faithful English translations of the approved wording', async () => {
    const document = await loadLegalDocument('tos')

    expect(document.markdown).toContain(APPROVED_ENGLISH_SECTION_8)
    expect(document.markdown).toContain(APPROVED_ENGLISH_SECTION_9)
    expect(document.markdown).toContain('| Google Identity (OAuth) | User authentication | See §12-bis |')
    expect(document.markdown).toContain('| YouTube Data API v3 | Reading public video metadata | No user data transmitted |')
    expect(document.markdown).toContain("| Google Gemini (or user's equivalent AI provider) | Summary generation | Video URL/transcript, not user data |")
    expect(document.markdown).toContain('| Firecrawl | Storage and verification of the personal Firecrawl key | API key (no transcript retrieved) |')
    expect(document.markdown).toContain('| Supabase (EU-hosted DB) | DB storage and backend auth | All user account data encrypted at rest |')
    expect(document.markdown).toContain('| Vercel (hosting) | Application delivery | Technical access logs (IP, user agent) |')
  })
})
