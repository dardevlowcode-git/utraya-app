/* Commento didattico:
 * Scopo del file: gestisce la configurazione internazionale (lingue supportate, caricamento messaggi e locale corrente).
 * Moduli richiamati: nessun import esterno: il file usa logica locale o sole primitive del linguaggio.
 * Flusso: La configurazione viene letta da middleware/layout/componenti per scegliere lingua e messaggi corretti.
 */

export const locales = ['it', 'en'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'it'
export const localeCookieName = 'NEXT_LOCALE'

// Add new languages by:
// 1) appending locale code to `locales`
// 2) adding display name here
// 3) creating `app/messages/<locale>.json`
export const localeNames: Record<Locale, string> = {
  it: 'Italiano',
  en: 'English',
}

/**
 * Type guard runtime per verificare che la stringa sia una locale supportata.
 */
export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale)
}
