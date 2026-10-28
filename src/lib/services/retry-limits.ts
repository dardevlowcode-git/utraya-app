import { createAdminClient } from '@/lib/supabase/admin'
import { RETRY_LIMIT_MAX } from '@/lib/utils/retry-limit'
import type { IntegrationProvider as Provider } from '@/lib/types/domain'

type AdminClient = ReturnType<typeof createAdminClient>

interface CredentialRow {
  id: string
  user_id: string
  provider: Provider
  is_configured: boolean
}

interface OwnerRow {
  id: string
  display_name: string | null
  email: string
}

interface CredentialRetryLimitRow {
  credential_id: string
  retry_limit: number
}

export interface CredentialRetryLimitViewModel {
  credentialId: string
  provider: Provider
  owner: string
  isConfigured: boolean
  retryLimit: number
  maxAttempts: number
}

export interface SharedYoutubeRetryLimitViewModel {
  providerKey: 'youtube_innertube'
  service: 'YouTube Innertube'
  identifier: 'YOUTUBEI_API_KEY'
  retryLimit: number
  maxAttempts: number
  active: false
}

export interface AdminRetryLimitsViewModel {
  credentials: CredentialRetryLimitViewModel[]
  sharedYoutube: SharedYoutubeRetryLimitViewModel
}

/** Convalida il valore amministrativo contro il tipo INTEGER persistito da PostgreSQL. */
function assertRetryLimit(retryLimit: number): void {
  if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > RETRY_LIMIT_MAX) {
    throw new Error('Retry limit deve essere un intero non negativo rappresentabile dal database')
  }
}

/** Carica limiti e metadati non segreti per la console admin. */
export async function getAdminRetryLimits(admin: AdminClient): Promise<AdminRetryLimitsViewModel> {
  const { data: credentialRows, error: credentialError } = await admin
    .from('user_provider_credentials')
    .select('id, user_id, provider, is_configured')
    .order('id', { ascending: true })

  if (credentialError) throw new Error('Impossibile caricare le credenziali per i limiti retry')

  const credentials = (credentialRows ?? []) as CredentialRow[]
  const ownerIds = Array.from(new Set(credentials.map((row) => row.user_id)))
  const credentialIds = credentials.map((row) => row.id)

  const [ownerResult, retryLimitResult, sharedResult] = await Promise.all([
    ownerIds.length === 0
      ? Promise.resolve({ data: [] as OwnerRow[], error: null })
      : admin.from('users').select('id, display_name, email').in('id', ownerIds),
    credentialIds.length === 0
      ? Promise.resolve({ data: [] as CredentialRetryLimitRow[], error: null })
      : admin.from('user_provider_credential_retry_limits')
        .select('credential_id, retry_limit')
        .in('credential_id', credentialIds),
    admin.from('shared_provider_retry_settings')
      .select('retry_limit')
      .eq('provider_key', 'youtube_innertube')
      .maybeSingle(),
  ])

  if (ownerResult.error || retryLimitResult.error || sharedResult.error) {
    throw new Error('Impossibile caricare i limiti retry amministrativi')
  }

  const ownersById = new Map((ownerResult.data ?? []).map((row) => [row.id, row as OwnerRow]))
  const retryLimitsByCredentialId = new Map(
    (retryLimitResult.data ?? []).map((row) => [row.credential_id, row.retry_limit])
  )
  const sharedRetryLimit = sharedResult.data?.retry_limit ?? 10

  return {
    credentials: credentials.map((row) => {
      const owner = ownersById.get(row.user_id)
      const retryLimit = retryLimitsByCredentialId.get(row.id) ?? 0
      return {
        credentialId: row.id,
        provider: row.provider,
        owner: owner?.display_name?.trim() || owner?.email || row.user_id,
        isConfigured: row.is_configured,
        retryLimit,
        maxAttempts: retryLimit + 1,
      }
    }),
    sharedYoutube: {
      providerKey: 'youtube_innertube',
      service: 'YouTube Innertube',
      identifier: 'YOUTUBEI_API_KEY',
      retryLimit: sharedRetryLimit,
      maxAttempts: sharedRetryLimit + 1,
      active: false,
    },
  }
}

/** Aggiorna il limite di una credenziale identificata senza accedere al segreto. */
export async function setCredentialRetryLimit(
  admin: AdminClient,
  credentialId: string,
  retryLimit: number
): Promise<{ credentialId: string; retryLimit: number } | null> {
  assertRetryLimit(retryLimit)

  const { data: credential, error: credentialError } = await admin
    .from('user_provider_credentials')
    .select('id')
    .eq('id', credentialId)
    .maybeSingle()

  if (credentialError) throw new Error('Impossibile verificare la credenziale')
  if (!credential) return null

  const { error } = await admin
    .from('user_provider_credential_retry_limits')
    .upsert({ credential_id: credentialId, retry_limit: retryLimit })

  if (error) throw new Error('Impossibile salvare il limite retry della credenziale')
  return { credentialId, retryLimit }
}

/** Aggiorna il solo setting amministrativo della chiave YouTube condivisa, senza agire sull'env. */
export async function setSharedYoutubeRetryLimit(
  admin: AdminClient,
  retryLimit: number
): Promise<{ providerKey: 'youtube_innertube'; retryLimit: number }> {
  assertRetryLimit(retryLimit)

  const { error } = await admin
    .from('shared_provider_retry_settings')
    .upsert({ provider_key: 'youtube_innertube', retry_limit: retryLimit })

  if (error) throw new Error('Impossibile salvare il limite retry YouTube condiviso')
  return { providerKey: 'youtube_innertube', retryLimit }
}
