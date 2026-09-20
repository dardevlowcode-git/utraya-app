/* Commento didattico:
 * Scopo del file: maschera visiva di email e nomi per demo/presentazioni (modalità presentazione).
 * Moduli richiamati: nessuno.
 * Flusso: funzioni pure chiamate dai componenti admin per mostrare "***" al posto del valore in chiaro.
 * Nota: NON è sicurezza del dato (il valore resta in API/DOM), solo protezione visiva da screen-sharing.
 */

/**
 * Maschera un'email mantenendo solo un indizio minimo per riconoscerla in admin.
 * es. "mario.rossi@gmail.com" -> "m***@g***.com"
 */
export function maskEmail(email: string): string {
  const normalized = email.trim()
  if (!normalized) return '****'
  const atIndex = normalized.indexOf('@')
  if (atIndex <= 0) return '****'
  const local = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1)
  if (!domain) return '****'

  const maskedLocal = local.length <= 1 ? '*' : `${local[0]}***`
  const dotIndex = domain.lastIndexOf('.')
  if (dotIndex <= 0) {
    return `${maskedLocal}@***`
  }
  const domainName = domain.slice(0, dotIndex)
  const tld = domain.slice(dotIndex + 1)
  const maskedDomain = domainName.length <= 1 ? '*' : `${domainName[0]}***`
  return `${maskedLocal}@${maskedDomain}.${tld}`
}

/**
 * Maschera un nome visualizzato parola per parola.
 * es. "Mario Rossi" -> "M*** R***", "Mario" -> "M***"
 */
export function maskDisplayName(name: string): string {
  const normalized = name.trim()
  if (!normalized) return '****'
  return normalized
    .split(/\s+/)
    .map((word) => (word.length <= 1 ? '*' : `${word[0]}***`))
    .join(' ')
}
