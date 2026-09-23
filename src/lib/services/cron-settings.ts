/* Commento didattico:
 * Scopo del file: incapsula la logica di accesso ai dati e le operazioni di dominio, separandole dalla UI.
 * Moduli richiamati: `@/lib/supabase/admin` per client service_role (bypass RLS, mai esposto al browser).
 * Flusso: Le funzioni del servizio vengono chiamate da API route o pagine server: qui avviene l'orchestrazione delle query e delle trasformazioni dati.
 */

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface TranscriptSettings {
  enabled: boolean
  batch_limit: number
}

export interface TranscriptStats {
  pending: number
  fetched: number
  missing: number
  failed: number
  legacy_missing: number
  total: number
}

const SCHEDULE_KEY = 'transcripts'
const DEFAULT_SETTINGS: TranscriptSettings = { enabled: true, batch_limit: 10 }
const STATUSES = ['pending', 'fetched', 'missing', 'failed', 'legacy_missing'] as const

/**
 * Legge le impostazioni del cron trascrizioni.
 * Ritorna i default `{enabled: true, batch_limit: 10}` se la riga e assente.
 */
export async function getTranscriptSettings(admin: AdminClient): Promise<TranscriptSettings> {
  // Tabella non ancora nei tipi DB: client usato in modo non tipizzato.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('cron_settings')
    .select('enabled, batch_limit')
    .eq('schedule_key', SCHEDULE_KEY)
    .maybeSingle()

  if (error) throw new Error(`Lettura cron_settings fallita: ${error.message}`)
  if (!data) return { ...DEFAULT_SETTINGS }
  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
    batch_limit:
      Number.isInteger(data.batch_limit) && data.batch_limit >= 1 && data.batch_limit <= 50
        ? data.batch_limit
        : 10,
  }
}

export interface TranscriptSettingsInput {
  enabled: boolean
  batch_limit: number
}

/**
 * Aggiorna le impostazioni del cron trascrizioni (upsert su schedule_key).
 * Lancia Error con messaggio chiaro se tipi o range non validi.
 */
export async function updateTranscriptSettings(
  admin: AdminClient,
  input: TranscriptSettingsInput
): Promise<TranscriptSettings> {
  if (typeof input.enabled !== 'boolean') {
    throw new Error('Campo enabled non valido: atteso boolean')
  }
  if (!Number.isInteger(input.batch_limit) || input.batch_limit < 1 || input.batch_limit > 50) {
    throw new Error('Campo batch_limit non valido: atteso intero tra 1 e 50')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('cron_settings')
    .upsert({ schedule_key: SCHEDULE_KEY, enabled: input.enabled, batch_limit: input.batch_limit })
    .select('enabled, batch_limit')
    .single()

  if (error) throw new Error(`Aggiornamento cron_settings fallito: ${error.message}`)
  return { enabled: data.enabled, batch_limit: data.batch_limit }
}

/**
 * Conteggi `video_transcripts` per status (solo numeri, mai testo trascrizione).
 */
export async function getTranscriptStats(admin: AdminClient): Promise<TranscriptStats> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = admin as any
  const counts = await Promise.all(
    STATUSES.map(async (status) => {
      const { count, error } = await untyped
        .from('video_transcripts')
        .select('id', { count: 'exact', head: true })
        .eq('transcript_status', status)
      if (error) throw new Error(`Conteggio trascrizioni (${status}) fallito: ${error.message}`)
      return (count ?? 0) as number
    })
  )
  const { count: total, error: totalError } = await untyped
    .from('video_transcripts')
    .select('id', { count: 'exact', head: true })
  if (totalError) throw new Error(`Conteggio trascrizioni (totale) fallito: ${totalError.message}`)

  const [pending, fetched, missing, failed, legacy_missing] = counts
  return { pending, fetched, missing, failed, legacy_missing, total: (total ?? 0) as number }
}
