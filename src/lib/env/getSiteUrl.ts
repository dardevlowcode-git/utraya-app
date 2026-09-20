/* Commento didattico:
 * Scopo del file: espone helper centralizzati per costruire URL assolute del sito in modo environment-aware.
 * Moduli richiamati: nessuno.
 * Flusso: i chiamanti invocano `getSiteUrl` e `buildSiteUrl` per evitare URL hard-coded nei redirect/callback.
 */

/**
 * Ritorna l'origin del sito corrente in modo sincrono.
 *
 * Priorita:
 * 1. `NEXT_PUBLIC_SITE_URL` (server/client build-time), senza trailing slash.
 * 2. `window.location.origin` se disponibile nel browser.
 * 3. fallback locale `http://localhost:3000`.
 */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')

  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  return 'http://localhost:3000'
}

/**
 * Compone un path relativo con la site origin normalizzando lo slash iniziale.
 */
export function buildSiteUrl(path: string): string {
  const base = getSiteUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}
