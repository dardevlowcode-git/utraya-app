/* Commento didattico:
 * Scopo del file: gestisce regole e utilita` legate ad autenticazione, permessi e controlli di accesso.
 * Moduli richiamati: `node:crypto`, `next/headers`
 * Flusso: Queste funzioni vengono usate da middleware, layout o API per decidere se un utente puo` accedere a una risorsa.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const adminSessionCookieName = 'cf_admin_session'
const adminSessionDurationSeconds = 60 * 60 * 12 // 12 hours

interface AdminAuthConfig {
  username: string
  passwordHash: string
  sessionSecret: string
}

export interface AdminSession {
  username: string
}

/**
 * Legge la configurazione admin da environment.
 * Ritorna `null` se una qualsiasi variabile richiesta e` assente.
 */
function getAdminAuthConfig(): AdminAuthConfig | null {
  const username = process.env.SUPERADMIN_USERNAME?.trim()
  const passwordHash = process.env.SUPERADMIN_PASSWORD_HASH?.trim()
  const sessionSecret = process.env.SUPERADMIN_SESSION_SECRET?.trim()

  if (!username || !passwordHash || !sessionSecret) {
    return null
  }

  return { username, passwordHash, sessionSecret }
}

/**
 * Variante strict di `getAdminAuthConfig`: lancia errore se configurazione incompleta.
 */
function requireAdminAuthConfig(): AdminAuthConfig {
  const config = getAdminAuthConfig()
  if (!config) {
    throw new Error(
      'Missing super admin auth config. Set SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD_HASH and SUPERADMIN_SESSION_SECRET.'
    )
  }
  return config
}

/**
 * Confronta due stringhe in tempo costante per mitigare timing attacks.
 */
function safeStringEquals(a: string, b: string): boolean {
  // Confronto a tempo costante: riduce il rischio di timing attacks.
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

/**
 * Codifica stringa UTF-8 in Base64URL.
 */
function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/**
 * Decodifica payload Base64URL in stringa UTF-8.
 */
function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

/**
 * Firma HMAC SHA-256 del payload.
 */
function signPayload(payload: string, secret: string): string {
  // Firma HMAC del payload: se il cookie viene alterato, la verifica fallisce.
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/**
 * Crea token sessione admin firmato con expiry e nonce anti-riuso.
 */
function createSessionToken(username: string, secret: string): string {
  // Token "stateless": contiene utente + scadenza + nonce, firmati lato server.
  const exp = Date.now() + adminSessionDurationSeconds * 1000
  const nonce = randomBytes(8).toString('hex')
  const payload = toBase64Url(JSON.stringify({ u: username, exp, n: nonce }))
  const signature = signPayload(payload, secret)
  return `${payload}.${signature}`
}

/**
 * Verifica integrita`/scadenza del token e ritorna la sessione admin.
 */
function parseAndVerifyToken(token: string, secret: string): AdminSession | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expectedSignature = signPayload(payload, secret)
  if (!safeStringEquals(signature, expectedSignature)) return null

  try {
    // Se il token e valido ma scaduto, la sessione viene considerata non valida.
    const parsed = JSON.parse(fromBase64Url(payload)) as { u?: string; exp?: number }
    if (!parsed.u || typeof parsed.exp !== 'number') return null
    if (Date.now() > parsed.exp) return null
    return { username: parsed.u }
  } catch {
    return null
  }
}

export function verifySuperAdminCredentials(username: string, password: string): boolean {
  const config = getAdminAuthConfig()
  if (!config) return false
  const normalizedUsername = username.trim()
  const isSupportedHash = config.passwordHash.startsWith('scrypt$')
  if (!isSupportedHash) return false

  const isPasswordValid = verifyScryptHash(password, config.passwordHash)

  return (
    safeStringEquals(normalizedUsername, config.username) &&
    isPasswordValid
  )
}

function verifyScryptHash(plainText: string, encodedHash: string): boolean {
  const parts = encodedHash.split('$')
  if (parts.length !== 7) return false
  const [scheme, nRaw, rRaw, pRaw, keyLenRaw, saltBase64, hashBase64] = parts
  if (scheme !== 'scrypt') return false

  const n = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  const keyLen = Number(keyLenRaw)
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || !Number.isFinite(keyLen)) {
    return false
  }

  try {
    const salt = Buffer.from(saltBase64, 'base64')
    const expectedHash = Buffer.from(hashBase64, 'base64')
    const derived = scryptSync(plainText, salt, keyLen, { N: n, r, p })
    if (derived.length !== expectedHash.length) return false
    return timingSafeEqual(derived, expectedHash)
  } catch {
    return false
  }
}

/**
 * Costruisce valore cookie sessione admin firmato.
 */
export function buildAdminSessionCookieValue(username: string): string {
  const { sessionSecret } = requireAdminAuthConfig()
  return createSessionToken(username, sessionSecret)
}

/**
 * Legge una sessione admin valida a partire dal valore cookie.
 */
export function readAdminSessionFromCookieValue(cookieValue: string | undefined): AdminSession | null {
  if (!cookieValue) return null
  const config = getAdminAuthConfig()
  if (!config) return null
  return parseAndVerifyToken(cookieValue, config.sessionSecret)
}

/**
 * Recupera la sessione admin direttamente dal cookie HTTP corrente.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  // Usata da route handler admin (`api/admin/*`) per autorizzare azioni sensibili.
  const cookieStore = await cookies()
  return readAdminSessionFromCookieValue(cookieStore.get(adminSessionCookieName)?.value)
}

/**
 * Durata sessione admin usata nei cookie (`maxAge`).
 */
export function getAdminSessionMaxAge(): number {
  return adminSessionDurationSeconds
}
