/* Commento didattico:
 * Scopo del file: esecuzione dei job di trascrizione automatici (video nuovi fino a 90 minuti) subito dopo uno scan.
 * Moduli richiamati: client admin, servizio richieste (esecuzione e controllo chiavi), continuazione interna.
 * Flusso: dopo lo scan si lavora UN job del canale con budget ridotto; a job concluso si chiede la continuazione
 * interna per il successivo, così i video si trascrivono uno alla volta senza cron al minuto. Senza chiave eleggibile
 * i job restano pending e li riprende il daily-sync.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  autoJobChannelId,
  hasEligibleChannelCredential,
  runTranscriptionJobNow,
} from '@/lib/services/transcription-requests'
import {
  TRANSCRIPTION_JOB_TYPE,
  type TranscriptionRunResult,
  type TranscriptionWorkerDeps,
} from '@/lib/services/transcription'
import { requestTranscriptionContinuation } from '@/lib/services/transcription-store'

/** Budget ridotto: la scansione ha già consumato parte della durata della route che la ospita. */
export const POST_SCAN_TRANSCRIPTION_BUDGET = { softBudgetMs: 90_000, hardBudgetMs: 150_000 } as const

/** Esiti che chiudono il job: dopo questi si passa al video successivo dello stesso canale. */
const FINISHED_OUTCOMES = new Set(['complete', 'needs_review', 'reused', 'failed'])

type AdminClient = ReturnType<typeof createAdminClient>

/** Primo job automatico pending del canale (escluso `excludeJobId`) se il canale ha una chiave eleggibile. */
async function findNextAutoJob(admin: AdminClient, channelId: string, excludeJobId?: string): Promise<string | null> {
  if (!(await hasEligibleChannelCredential(admin, channelId))) return null
  const { data, error } = await admin
    .from('jobs')
    .select('id')
    .eq('job_type', TRANSCRIPTION_JOB_TYPE)
    .eq('status', 'pending')
    .eq('payload->>channelId', channelId)
    .order('created_at', { ascending: true })
    .limit(2)
  if (error) return null
  return (data ?? []).find((job) => job.id !== excludeJobId)?.id ?? null
}

/** Esegue il job e, se si è concluso, chiede la continuazione interna per il prossimo video automatico del canale. */
export async function runTranscriptionJobAndChain(
  jobId: string,
  overrides: Partial<TranscriptionWorkerDeps> = {}
): Promise<TranscriptionRunResult> {
  const result = await runTranscriptionJobNow(jobId, overrides)
  if (!FINISHED_OUTCOMES.has(result.outcome)) return result
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('jobs').select('payload').eq('id', jobId).maybeSingle()
    const channelId = autoJobChannelId(data?.payload)
    if (channelId) {
      const next = await findNextAutoJob(admin, channelId, jobId)
      if (next) await requestTranscriptionContinuation(next)
    }
  } catch {
    // Il job successivo resta pending: lo riprende il recupero del daily-sync.
  }
  return result
}

/**
 * Da chiamare dentro `after()` (restituendo la Promise) dopo una scansione: lavora un job automatico pending del canale.
 * Non fa nulla se non ci sono job o chiavi eleggibili. Non lancia mai.
 */
export async function runAutoTranscriptionsForChannel(
  channelId: string,
  overrides: Partial<TranscriptionWorkerDeps> = POST_SCAN_TRANSCRIPTION_BUDGET
): Promise<TranscriptionRunResult | null> {
  try {
    const next = await findNextAutoJob(createAdminClient(), channelId)
    return next ? await runTranscriptionJobAndChain(next, overrides) : null
  } catch {
    return null
  }
}
