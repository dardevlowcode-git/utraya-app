/* Commento didattico:
 * Scopo del file: incapsula la logica di accesso ai dati e le operazioni di dominio, separandole dalla UI.
 * Moduli richiamati: `node:crypto`, `@/lib/supabase/server`, `@/lib/utils/errors`, `@/lib/types/domain`, `@/lib/types/database`
 * Flusso: Le funzioni del servizio vengono chiamate da API route o pagine server: qui avviene l'orchestrazione delle query e delle trasformazioni dati.
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError, classifyError } from '@/lib/utils/errors'
import type { CredentialStatus } from '@/lib/types/domain'
import type { Database } from '@/lib/types/database'

type Provider = 'youtube' | 'gemini'

type CredentialRow = Database['public']['Tables']['user_provider_credentials']['Row']

const PROVIDERS: Provider[] = ['youtube', 'gemini']
const AES_GCM_IV_LENGTH = 12
const AES_GCM_AUTH_TAG_LENGTH = 16

/**
 * Legge la chiave applicativa usata per cifrare le API key utente.
 * Solleva errore strutturale se non configurata.
 */
function getEncryptionSecret(): string {
  // La chiave resta solo server-side: il client non deve mai conoscerla.
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!secret) {
    throw new AppError(
      'Manca CREDENTIAL_ENCRYPTION_KEY: configura la chiave server-side per cifrare le API key',
      'structural',
      500
    )
  }
  return secret
}

/**
 * Deriva una chiave AES-256 deterministica a partire dal segreto applicativo.
 */
function deriveKey(secret: string): Buffer {
  // Derivazione deterministica della chiave AES-256 dal segreto applicativo.
  return createHash('sha256').update(secret).digest()
}

/**
 * Cifra una API key in formato versionato `v1:iv:tag:ciphertext`.
 */
function encryptSecret(plainText: string): string {
  const key = deriveKey(getEncryptionSecret())
  const iv = randomBytes(AES_GCM_IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: AES_GCM_AUTH_TAG_LENGTH,
  })

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plainText, 'utf8')),
    cipher.final(),
  ])

  const authTag = cipher.getAuthTag()
  // Formato versionato: facilita eventuali rotazioni future dell'algoritmo.
  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

/**
 * Decifra il formato versionato salvato in database.
 */
function decryptSecret(cipherText: string): string {
  const parts = cipherText.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new AppError('Formato credenziale cifrata non valido', 'structural', 500)
  }

  const key = deriveKey(getEncryptionSecret())
  const iv = Buffer.from(parts[1], 'base64')
  const authTag = Buffer.from(parts[2], 'base64')
  const payload = Buffer.from(parts[3], 'base64')

  if (iv.length !== AES_GCM_IV_LENGTH) {
    throw new AppError('Formato vettore inizializzazione non valido', 'structural', 500)
  }

  if (authTag.length !== AES_GCM_AUTH_TAG_LENGTH) {
    throw new AppError('Formato auth tag non valido', 'structural', 500)
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: AES_GCM_AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Maschera una chiave per l'esposizione UI senza rivelare il valore completo.
 */
function maskApiKey(value: string | null): string | null {
  // Mostra solo parte finale per UX, senza esporre segreto completo.
  if (!value) return null
  const compact = value.trim()
  if (compact.length <= 4) return '****'
  return `${'*'.repeat(Math.max(compact.length - 4, 6))}${compact.slice(-4)}`
}

/**
 * Valida che il provider richiesto sia tra quelli supportati in V1.
 */
function assertProvider(provider: string): asserts provider is Provider {
  if (!PROVIDERS.includes(provider as Provider)) {
    throw new AppError('Provider non supportato', 'validation', 400)
  }
}

/**
 * Carica la riga credenziali di un provider per l'utente.
 */
async function getCredentialRow(userId: string, provider: Provider): Promise<CredentialRow | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('user_provider_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    throw new AppError('Impossibile leggere le credenziali', 'unknown', 500, { cause: error.message })
  }

  return data
}

/**
 * Restituisce la chiave in chiaro solo lato server quando necessaria ai service.
 */
export async function getProviderApiKeyForUser(userId: string, provider: Provider): Promise<string | null> {
  const row = await getCredentialRow(userId, provider)
  if (!row?.encrypted_key || !row.is_configured) return null

  try {
    // Decifra solo quando realmente necessario (principio least exposure).
    return decryptSecret(row.encrypted_key)
  } catch (error) {
    throw new AppError('Impossibile decifrare la chiave API', 'structural', 500, {
      cause: error instanceof Error ? error.message : 'decrypt_failed',
    })
  }
}

/**
 * Variante admin-only: legge la chiave API bypassando RLS utente.
 */
export async function getProviderApiKeyForUserAsAdmin(userId: string, provider: Provider): Promise<string | null> {
  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('user_provider_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    throw new AppError('Impossibile leggere le credenziali utente', 'unknown', 500, { cause: error.message })
  }

  if (!row?.encrypted_key || !row.is_configured) return null

  try {
    return decryptSecret(row.encrypted_key)
  } catch (error) {
    throw new AppError('Impossibile decifrare la chiave API', 'structural', 500, {
      cause: error instanceof Error ? error.message : 'decrypt_failed',
    })
  }
}

/**
 * Restituisce lo stato integrazioni per tutti i provider supportati.
 * La risposta e` uniforme anche quando un provider non e` ancora configurato.
 */
export async function getCredentialStatusesForUser(userId: string): Promise<CredentialStatus[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('user_provider_credentials')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    throw new AppError('Impossibile caricare stato integrazioni', 'unknown', 500, { cause: error.message })
  }

  const byProvider = new Map<Provider, CredentialRow>()
  for (const row of data ?? []) {
    if (row.provider === 'youtube' || row.provider === 'gemini') {
      byProvider.set(row.provider, row)
    }
  }

  const statuses: CredentialStatus[] = [] // Risposta uniforme per tutti i provider supportati.

  for (const provider of PROVIDERS) {
    const row = byProvider.get(provider)
    let maskedKey: string | null = null

    if (row?.is_configured && row.encrypted_key) {
      try {
        maskedKey = maskApiKey(decryptSecret(row.encrypted_key))
      } catch {
        maskedKey = null
      }
    }

    statuses.push({
      provider,
      isConfigured: row?.is_configured ?? false,
      isValid: row?.is_valid ?? null,
      lastValidatedAt: row?.last_validated_at ?? null,
      lastUsedAt: row?.last_used_at ?? null,
      lastError: row?.last_error ?? null,
      maskedKey,
    })
  }

  return statuses
}

/**
 * Salva o aggiorna la chiave API di un provider.
 * Opzionalmente valida subito la chiave per dare feedback immediato alla UI.
 */
export async function saveApiKey(params: {
  userId: string
  provider: Provider
  apiKey: string
  validateNow?: boolean
}): Promise<{ provider: Provider; maskedKey: string; isValid: boolean | null; validationMessage: string | null }> {
  assertProvider(params.provider)

  const normalized = params.apiKey.trim()
  if (normalized.length < 10) {
    throw new AppError('Chiave API non valida: lunghezza troppo corta', 'validation', 400)
  }

  const supabase = await createClient()
  const encrypted = encryptSecret(normalized)

  // Upsert per provider: aggiorna in-place senza creare record duplicati.
  const { error } = await supabase
    .from('user_provider_credentials')
    .upsert(
      {
        user_id: params.userId,
        provider: params.provider,
        encrypted_key: encrypted,
        is_configured: true,
        is_valid: null,
        last_error: null,
        last_used_at: null,
      },
      { onConflict: 'user_id,provider' }
    )

  if (error) {
    throw new AppError('Impossibile salvare la chiave API', 'unknown', 500, { cause: error.message })
  }

  if (params.validateNow === false) {
    return {
      provider: params.provider,
      maskedKey: maskApiKey(normalized) ?? '****',
      isValid: null,
      validationMessage: null,
    }
  }

  const validation = await validateApiKey({
    userId: params.userId,
    provider: params.provider,
  })

  return {
    provider: params.provider,
    maskedKey: maskApiKey(normalized) ?? '****',
    isValid: validation.isValid,
    validationMessage: validation.message,
  }
}

/**
 * Verifica una chiave YouTube con una chiamata minima read-only.
 */
async function validateYouTubeApiKey(apiKey: string): Promise<void> {
  // Chiamata minima a endpoint YouTube per confermare validita credenziale.
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', 'youtube')
  url.searchParams.set('maxResults', '1')
  url.searchParams.set('type', 'video')
  url.searchParams.set('key', apiKey)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`YouTube validation failed (${response.status}): ${text.slice(0, 200)}`)
  }
}

/**
 * Verifica una chiave Gemini con una chiamata minima read-only.
 */
async function validateGeminiApiKey(apiKey: string): Promise<void> {
  // Chiamata minima a endpoint Gemini: se risponde 2xx la chiave e valida.
  const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
  url.searchParams.set('key', apiKey)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Gemini validation failed (${response.status}): ${text.slice(0, 200)}`)
  }
}

/**
 * Esegue validazione provider-specific e persiste esito in `user_provider_credentials`.
 * Registra inoltre uno storico in `credential_checks`.
 */
export async function validateApiKey(params: {
  userId: string
  provider: Provider
}): Promise<{ provider: Provider; isValid: boolean; message: string | null }> {
  assertProvider(params.provider)

  const apiKey = await getProviderApiKeyForUser(params.userId, params.provider)
  if (!apiKey) {
    throw new AppError('Chiave API non configurata', 'validation', 400)
  }

  const supabase = await createClient()
  let isValid = false
  let errorMessage: string | null = null

  try {
    if (params.provider === 'youtube') {
      await validateYouTubeApiKey(apiKey)
    } else {
      await validateGeminiApiKey(apiKey)
    }
    isValid = true
  } catch (error) {
    isValid = false
    errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto'
  }

  const now = new Date().toISOString()

  // Salva stato piu recente usato dalla UI integrazioni.
  const { error: updateError } = await supabase
    .from('user_provider_credentials')
    .update({
      is_valid: isValid,
      last_validated_at: now,
      last_error: errorMessage,
    })
    .eq('user_id', params.userId)
    .eq('provider', params.provider)

  if (updateError) {
    throw new AppError('Impossibile aggiornare lo stato validazione', 'unknown', 500, {
      cause: updateError.message,
    })
  }

  const credential = await getCredentialRow(params.userId, params.provider)
  if (credential) {
    // Audit storico tentativi di validazione (utile per diagnosi operative).
    await supabase.from('credential_checks').insert({
      credential_id: credential.id,
      is_valid: isValid,
      error_message: errorMessage,
      error_type: isValid ? null : (classifyError(errorMessage) === 'temporary' ? 'temporary' : 'structural'),
    })
  }

  return {
    provider: params.provider,
    isValid,
    message: isValid ? null : errorMessage,
  }
}

/**
 * Rimuove logicamente la chiave API: resetta cifrato e flag mantenendo il record.
 */
export async function removeApiKey(params: {
  userId: string
  provider: Provider
}): Promise<void> {
  assertProvider(params.provider)

  const supabase = await createClient()

  // Soft reset dello stato: mantiene il record ma azzera dati sensibili e flag.
  const { error } = await supabase
    .from('user_provider_credentials')
    .update({
      encrypted_key: null,
      is_configured: false,
      is_valid: null,
      last_validated_at: null,
      last_used_at: null,
      last_error: null,
    })
    .eq('user_id', params.userId)
    .eq('provider', params.provider)

  if (error) {
    throw new AppError('Impossibile rimuovere la chiave API', 'unknown', 500, { cause: error.message })
  }
}
