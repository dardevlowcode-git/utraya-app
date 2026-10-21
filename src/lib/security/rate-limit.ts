/* Commento didattico:
 * Scopo del file: rate limiting minimale in-memory per le API esposte senza nuove dipendenze.
 * Moduli richiamati: nessuno.
 * Flusso: le route contano le richieste per chiave in una finestra fissa e rifiutano con 429 oltre la soglia.
 */

type Bucket = {
  count: number
  resetAt: number
}

// Nota serverless: su Vercel ogni istanza ha il proprio contatore, quindi
// questa e` una protezione best-effort anti-burst, non un limite distribuito.
// Il limite distribuito (Redis/Edge) resta follow-up documentato in SECURITY.md.
const buckets = new Map<string, Bucket>()

const MAX_BUCKETS = 5000

export type RateLimitDecision = {
  allowed: boolean
  remaining: number
  resetAfterMs: number
}

// Valuta una richiesta contro la finestra fissa della chiave indicata.
// Il parametro `now` esiste solo per rendere il comportamento deterministico nei test.
export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) pruneExpiredBuckets(now)
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: Math.max(limit - 1, 0), resetAfterMs: windowMs }
  }

  bucket.count += 1
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, resetAfterMs: Math.max(bucket.resetAt - now, 0) }
  }
  return { allowed: true, remaining: Math.max(limit - bucket.count, 0), resetAfterMs: Math.max(bucket.resetAt - now, 0) }
}

// Rimuove i bucket scaduti quando la mappa cresce oltre la soglia di sicurezza.
function pruneExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

// Svuota tutti i contatori. Usato solo nei test per isolare i casi.
export function resetRateLimits(): void {
  buckets.clear()
}
