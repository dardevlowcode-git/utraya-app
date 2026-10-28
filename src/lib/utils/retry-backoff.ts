/* Commento didattico:
 * Scopo: calcola la prossima scadenza di retry per chiamate provider persistenti.
 * Moduli richiamati: Date nativa.
 * Flusso: applica il massimo fra backoff esponenziale (cappato a 60 secondi) e Retry-After del provider.
 */

const MAX_RETRY_DELAY_MS = 60_000

/** Calcola una scadenza deterministica per i worker. */
export function computeRetryAt(attemptNumber: number, retryAfter: string | null, now = Date.now()): string {
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN
  const retryAfterDate = retryAfter ? Date.parse(retryAfter) : Number.NaN
  const providerDelayMs = Number.isFinite(retryAfterSeconds)
    ? Math.max(0, retryAfterSeconds * 1000)
    : Number.isFinite(retryAfterDate)
      ? Math.max(0, retryAfterDate - now)
      : 0
  const exponentialDelayMs = Math.min(1_000 * (2 ** Math.max(attemptNumber - 1, 0)), MAX_RETRY_DELAY_MS)
  return new Date(now + Math.max(providerDelayMs, exponentialDelayMs)).toISOString()
}
