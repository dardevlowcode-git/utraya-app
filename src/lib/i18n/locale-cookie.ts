import { localeCookieName, type Locale } from './config'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/** Scrive la locale scelta nel cookie condiviso dal sito. */
export function writeLocaleCookie(locale: Locale): void {
  document.cookie = `${localeCookieName}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}
