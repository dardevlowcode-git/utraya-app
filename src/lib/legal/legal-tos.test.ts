/* Commento didattico:
 * Scopo del file: verifica il contenuto TOS mostrato e la coerenza dei metadata richiesti.
 * Moduli richiamati: caricamento pubblico dei documenti legali e costanti di accettazione.
 * Flusso: controlla versione/hash effettivi e la presenza letterale degli inserti approvati IT/EN.
 */

import { describe, expect, it } from 'vitest'
import { TOS_REQUIRED_HASH, TOS_REQUIRED_VERSION } from '@/lib/legal/required'
import { loadLegalDocument } from '@/lib/legal/documents'

const APPROVED_ITALIAN_SECTION_8 =
  "Inserendo e salvando una chiave API personale, l'utente ne abilita l'utilizzo automatico da parte di Utraya per le funzionalità associate al servizio. Per elaborare i contenuti di un canale, Utraya può utilizzare una delle chiavi idonee degli utenti che seguono quel canale, alternandole separatamente per canale e fornitore. Il consumo viene attribuito dal fornitore all'account o al team associato alla chiave utilizzata, secondo il relativo piano e le condizioni applicabili. L'alternanza riguarda i lavori assegnati e non garantisce consumi o costi uguali. I risultati già disponibili vengono riutilizzati senza ripetere l'elaborazione. Rimuovendo la chiave, questa viene esclusa dalle nuove assegnazioni."

const APPROVED_ITALIAN_SECTION_9 =
  'Eventuali consumi, limiti e costi dei servizi esterni sono distinti da quelli di Utraya e dipendono dalle condizioni del relativo fornitore.'

const APPROVED_ENGLISH_SECTION_8 =
  "By entering and saving a personal API key, the user enables Utraya to use it automatically for the features associated with the service. To process a channel's content, Utraya may use one of the eligible keys belonging to users who follow that channel, alternating them separately by channel and provider. The provider attributes usage to the account or team associated with the key used, according to the applicable plan and terms. Alternation applies to assigned jobs and does not guarantee equal usage or costs. Results already available are reused without repeating processing. Removing the key excludes it from new assignments."

const APPROVED_ENGLISH_SECTION_9 =
  "Any usage, limits, and costs of external services are separate from those of Utraya and depend on the applicable provider's terms."

describe('legal TOS document', () => {
  it('serves the required version with a hash matching the document', async () => {
    const document = await loadLegalDocument('tos')

    expect(document.version).toBe(TOS_REQUIRED_VERSION)
    expect(document.hash).toBe(TOS_REQUIRED_HASH)
    expect(TOS_REQUIRED_VERSION).not.toBe('2026-05-16-1')
  })

  it('includes the exact approved Italian wording and Firecrawl provider row', async () => {
    const document = await loadLegalDocument('tos')

    expect(document.markdown).toContain(APPROVED_ITALIAN_SECTION_8)
    expect(document.markdown).toContain(APPROVED_ITALIAN_SECTION_9)
    expect(document.markdown).toContain('| Firecrawl | Recupero delle trascrizioni dei video YouTube | URL dei video YouTube |')
  })

  it('includes faithful English translations of the approved wording', async () => {
    const document = await loadLegalDocument('tos')

    expect(document.markdown).toContain(APPROVED_ENGLISH_SECTION_8)
    expect(document.markdown).toContain(APPROVED_ENGLISH_SECTION_9)
    expect(document.markdown).toContain('| Firecrawl | Retrieval of YouTube video transcripts | YouTube video URLs |')
  })
})
