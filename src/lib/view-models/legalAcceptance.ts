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