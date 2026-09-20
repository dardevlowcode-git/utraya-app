/* Commento didattico:
 * Scopo del file: definisce il view model dello stato accettazione legale utente rispetto alle versioni richieste.
 * Moduli richiamati: nessuno.
 * Flusso: service legal produce questo modello e UI/layout lo usa per redirect e rendering pagina accettazione.
 */

export type LegalAcceptanceKind = 'tos' | 'tos_vexatorious'

export type LegalAcceptanceView = {
  needsAcceptance: boolean
  missing: LegalAcceptanceKind[]
  tosVersion: string
  tosHash: string
  tosVexVersion: string
  tosVexHash: string
  privacyVersion: string
  privacyHash: string
  currentLocale: 'it' | 'en'
}