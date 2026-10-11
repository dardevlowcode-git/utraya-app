/* Commento didattico:
 * Scopo del file: incapsula la logica di accesso ai dati e le operazioni di dominio, separandole dalla UI.
 * Moduli richiamati: `node:crypto`, `@/lib/supabase/server`, `@/lib/utils/errors`, `@/lib/types/domain`, `@/lib/types/database`
 * Flusso: Le funzioni del servizio vengono chiamate da API route o pagine server: qui avviene l'orchestrazione delle query e delle trasformazioni dati.
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAndRecordProviderRequest } from '@/lib/services/api-usage'
import { AppError, classifyError } from '@/lib/utils/errors'
import {
  enqueueCredentialValidation,
  getCredentialValidationStatusesForUser,
  type CredentialValidationAttemptResult,
  type CredentialValidationJobPayload,
} from '@/lib/services/credential-validation-jobs'
import { INTEGRATION_PROVIDERS as PROVIDERS, type CredentialStatus, type IntegrationProvider as Provider } from '@/lib/types/domain'
import type { Database } from '@/lib/types/database'
import type { AppSupabaseClient } from '@/lib/supabase/types'

type CredentialRow = Database['public']['Tables']['user_provider_credentials']['Row']

const AES_GCM_IV_LENGTH = 12
const AES_GCM_AUTH_TAG_LENGTH = 16
const YOUTUBE_VALIDATION_TIMEOUT_MS = 10_000
const GEMINI_VALIDATION_TIMEOUT_MS = 5_000
const FIRECRAWL_DISCOVERY_TIMEOUT_MS = 10_000
const MAX_CREDENTIAL_SAVE_CAS_ATTEMPTS = 3

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
async function getCredentialRow(userId: string, provider: Provider, client?: AppSupabaseClient): Promise<CredentialRow | null> {
  const supabase = client ?? await createClient()

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
export async function getProviderApiKeyForUser(userId: string, provider: Provider, client?: AppSupabaseClient): Promise<string | null> {
  const row = await getCredentialRow(userId, provider, client)
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
export async function getCredentialStatusesForUser(userId: string, client?: AppSupabaseClient): Promise<CredentialStatus[]> {
  const supabase = client ?? await createClient()

  const { data, error } = await supabase
    .from('user_provider_credentials')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    throw new AppError('Impossibile caricare stato integrazioni', 'unknown', 500, { cause: error.message })
  }

  const byProvider = new Map<Provider, CredentialRow>()
  for (const row of data ?? []) {
    if (PROVIDERS.includes(row.provider)) byProvider.set(row.provider, row)
  }

  const credentialIds = (data ?? []).map((row) => row.id)
  const keyVersions = new Map<string, string>()
  if (credentialIds.length > 0) {
    const { data: retryRows, error: retryError } = await createAdminClient()
      .from('user_provider_credential_retry_limits')
      .select('credential_id, key_version')
      .in('credential_id', credentialIds)
    if (retryError) {
      throw new AppError('Impossibile leggere versione credenziali', 'unknown', 500, { cause: retryError.message })
    }
    for (const retryRow of retryRows ?? []) keyVersions.set(retryRow.credential_id, retryRow.key_version)
  }

  const activeValidationStatuses = await getCredentialValidationStatusesForUser(userId, supabase, keyVersions)

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
      validationStatus: row?.is_configured
        ? activeValidationStatuses.get(row.id) ?? (row.is_valid === null ? 'idle' : 'completed')
        : 'idle',
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
 * Opzionalmente accoda la verifica persistente e restituisce lo stato pending alla UI.
 */
export async function saveApiKey(params: {
  userId: string
  provider: Provider
  apiKey: string
  validateNow?: boolean
  supabase?: AppSupabaseClient
}): Promise<{
  provider: Provider
  maskedKey: string
  isValid: boolean | null
  validationMessage: string | null
  validationStatus: 'idle' | 'pending' | 'running' | 'completed'
  jobId: string | null
}> {
  assertProvider(params.provider)

  const normalized = params.apiKey.trim()
  if (normalized.length < 10) {
    throw new AppError('Chiave API non valida: lunghezza troppo corta', 'validation', 400)
  }

  const supabase = params.supabase ?? await createClient()
  const encrypted = encryptSecret(normalized)
  let saved = false

  for (let attempt = 0; attempt < MAX_CREDENTIAL_SAVE_CAS_ATTEMPTS; attempt += 1) {
    const previousCredential = await getCredentialRow(params.userId, params.provider, supabase)
    const unchangedSecret = previousCredential?.encrypted_key
      ? safelyDecryptSecret(previousCredential.encrypted_key) === normalized
      : false
    const previousPolicy = previousCredential
      ? await getCredentialRetryPolicy(previousCredential.id)
      : null
    const { data, error } = await createAdminClient().rpc('save_user_provider_credential_atomic', {
      p_credential_id: previousCredential?.id ?? null,
      p_user_id: params.userId,
      p_provider: params.provider,
      p_encrypted_key: encrypted,
      p_expected_encrypted_key: previousCredential?.encrypted_key ?? null,
      p_expected_key_version: previousPolicy?.keyVersion ?? null,
      p_reset_retry_policy: Boolean(previousCredential && !unchangedSecret),
    })
    if (error) {
      throw new AppError('Impossibile salvare la chiave API', 'unknown', 500, { cause: error.message })
    }
    const outcome = data?.[0]
    if (outcome?.status === 'saved') {
      saved = true
      break
    }
    if (outcome?.status !== 'conflict') {
      throw new AppError('Risposta non valida dal salvataggio credenziale', 'structural', 500)
    }
  }

  if (!saved) {
    throw new AppError('La credenziale è cambiata durante il salvataggio; riprova', 'temporary', 409)
  }

  if (params.validateNow === false) {
    return {
      provider: params.provider,
      maskedKey: maskApiKey(normalized) ?? '****',
      isValid: null,
      validationMessage: null,
      validationStatus: 'idle',
      jobId: null,
    }
  }

  const validation = await validateApiKey({
    userId: params.userId,
    provider: params.provider,
    supabase: params.supabase,
  })

  return {
    provider: params.provider,
    maskedKey: maskApiKey(normalized) ?? '****',
    isValid: validation.isValid,
    validationMessage: validation.message,
    validationStatus: validation.validationStatus,
    jobId: validation.jobId,
  }
}

/** Legge limite e versione segreta in modo privilegiato senza restituirli alla UI. */
async function getCredentialRetryPolicy(credentialId: string): Promise<{ retryLimit: number; keyVersion: string }> {
  const { data, error } = await createAdminClient()
    .from('user_provider_credential_retry_limits')
    .select('retry_limit, key_version')
    .eq('credential_id', credentialId)
    .maybeSingle()

  if (error) throw new AppError('Impossibile leggere il limite retry credenziale', 'unknown', 500, { cause: error.message })
  if (!data?.key_version) throw new AppError('Versione retry credenziale mancante', 'structural', 500)
  return { retryLimit: data.retry_limit, keyVersion: data.key_version }
}

/** Confronta il segreto precedente solo in memoria; un ciphertext illeggibile equivale a credenziale diversa. */
function safelyDecryptSecret(cipherText: string): string | null {
  try {
    return decryptSecret(cipherText)
  } catch {
    return null
  }
}

/** Accoda la verifica same-key: il provider verrà chiamato da una lease e non nella request utente. */
export async function validateApiKey(params: {
  userId: string
  provider: Provider
  supabase?: AppSupabaseClient
}): Promise<{
  provider: Provider
  isValid: boolean | null
  message: string | null
  validationStatus: 'pending' | 'running'
  jobId: string
}> {
  assertProvider(params.provider)
  const credential = await getCredentialRow(params.userId, params.provider, params.supabase)
  if (!credential?.encrypted_key || !credential.is_configured) {
    throw new AppError('Chiave API non configurata', 'validation', 400)
  }
  if (!safelyDecryptSecret(credential.encrypted_key)) {
    throw new AppError('Impossibile decifrare la chiave API', 'structural', 500)
  }

  const policy = await getCredentialRetryPolicy(credential.id)
  const job = await enqueueCredentialValidation({
    credentialId: credential.id,
    userId: params.userId,
    provider: params.provider,
    keyVersion: policy.keyVersion,
    retryLimit: policy.retryLimit,
  })

  return {
    provider: params.provider,
    isValid: credential.is_valid,
    message: null,
    validationStatus: job.status,
    jobId: job.jobId,
  }
}

/** Esegue un solo tentativo read-only per la versione esatta della credenziale inclusa nel job. */
export async function performCredentialValidationAttempt(
  payload: CredentialValidationJobPayload
): Promise<CredentialValidationAttemptResult> {
  const admin = createAdminClient()
  const { data: credential, error: credentialError } = await admin
    .from('user_provider_credentials')
    .select('id, user_id, provider, encrypted_key, is_configured')
    .eq('id', payload.credentialId)
    .eq('user_id', payload.userId)
    .eq('provider', payload.provider)
    .maybeSingle()

  if (credentialError) throw new AppError('Impossibile leggere la credenziale per la verifica', 'unknown', 500, { cause: credentialError.message })
  const policy = await getCredentialRetryPolicy(payload.credentialId)
  if (!credential?.is_configured || !credential.encrypted_key || policy.keyVersion !== payload.keyVersion) {
    return { isValid: false, retryable: false, message: 'Credenziale sostituita o rimossa', errorType: 'structural', credentialChanged: true }
  }

  const apiKey = safelyDecryptSecret(credential.encrypted_key)
  if (!apiKey) {
    return { isValid: false, retryable: false, message: 'Impossibile decifrare la chiave API', errorType: 'structural', credentialChanged: false }
  }

  try {
    if (payload.provider === 'firecrawl') {
      const response = await fetchAndRecordProviderRequest({
        userId: payload.userId,
        provider: 'firecrawl',
        operation: 'alexandria.find-tools',
        url: 'https://api.firecrawl.dev/v2/scrape',
        init: {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            alexandria: {
              provider: 'firecrawl',
              capability: 'find-tools',
              options: {
                providers: ['youtube'],
                capabilities: ['read'],
                level: 'tools',
                expand: ['options', 'response'],
                limit: 1,
              },
            },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(FIRECRAWL_DISCOVERY_TIMEOUT_MS),
        },
      })

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        const retryable = response.status >= 500 && response.status <= 599
        return {
          isValid: false,
          retryable,
          message: `Firecrawl discovery request failed (HTTP ${response.status})`,
          errorType: retryable ? 'temporary' : 'structural',
          credentialChanged: false,
        }
      }

      const result = await response.json().catch(() => null) as {
        success?: unknown
        data?: { alexandria?: Array<{
          provider?: unknown
          capability?: unknown
          data?: { items?: Array<{ provider?: unknown; capability?: unknown }> }
        }> }
      } | null
      const findTools = result?.data?.alexandria?.find(
        (item) => item.provider === 'firecrawl' && item.capability === 'find-tools'
      )
      const hasYoutubeRead = findTools?.data?.items?.some(
        (item) => item.provider === 'youtube' && item.capability === 'read'
      )
      if (result?.success === true && hasYoutubeRead) {
        return { isValid: true, retryable: false, message: null, errorType: null, credentialChanged: false }
      }
      return {
        isValid: false,
        retryable: false,
        message: 'Firecrawl discovery access could not be confirmed',
        errorType: 'structural',
        credentialChanged: false,
      }
    }

    const url = payload.provider === 'youtube'
      ? new URL('https://www.googleapis.com/youtube/v3/search')
      : new URL('https://generativelanguage.googleapis.com/v1beta/models')
    const operation = payload.provider === 'youtube' ? 'search.list' : 'models.list'
    if (payload.provider === 'youtube') {
      url.searchParams.set('part', 'snippet')
      url.searchParams.set('q', 'youtube')
      url.searchParams.set('maxResults', '1')
      url.searchParams.set('type', 'video')
    }
    url.searchParams.set('key', apiKey)

    const response = await fetchAndRecordProviderRequest({
      userId: payload.userId,
      provider: payload.provider,
      operation,
      url: url.toString(),
      init: {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(payload.provider === 'youtube' ? YOUTUBE_VALIDATION_TIMEOUT_MS : GEMINI_VALIDATION_TIMEOUT_MS),
      },
    })

    if (response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return { isValid: true, retryable: false, message: null, errorType: null, credentialChanged: false }
    }

    const detail = await response.text().catch(() => '')
    const message = `${payload.provider} validation failed (${response.status}): ${detail.slice(0, 200)}`
    const retryable = response.status >= 500 && response.status <= 599
    return {
      isValid: false,
      retryable,
      message,
      errorType: retryable ? 'temporary' : 'structural',
      credentialChanged: false,
    }
  } catch (error) {
    const retryable = error instanceof TypeError
      || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    return {
      isValid: false,
      retryable,
      message: retryable ? 'Provider validation temporarily unavailable' : 'Provider validation failed',
      errorType: retryable ? 'temporary' : 'structural',
      credentialChanged: false,
    }
  }
}

/**
 * Scrive lo storico usando il client server-side con service role: `credential_checks`
 * non espone una policy INSERT agli utenti autenticati. Un errore di audit non deve
 * trasformare una validazione provider già conclusa in un errore per l'utente.
 */
export async function writeCredentialCheckAudit(params: {
  credential_id: string
  is_valid: boolean
  error_message: string | null
  error_type: 'temporary' | 'structural' | null
}): Promise<void> {
  try {
    const { error } = await createAdminClient().from('credential_checks').insert(params)
    if (error) throw error
  } catch {
    // Non loggare errori provider o credenziali; segnala solo la perdita della riga audit.
    console.error('credential_checks audit insert failed; validation result retained')
  }
}

/**
 * Rimuove logicamente la chiave API: resetta cifrato e flag mantenendo il record.
 */
export async function removeApiKey(params: {
  userId: string
  provider: Provider
  supabase?: AppSupabaseClient
}): Promise<void> {
  assertProvider(params.provider)

  const supabase = params.supabase ?? await createClient()

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
