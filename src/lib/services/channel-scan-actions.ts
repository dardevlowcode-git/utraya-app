/* Commento didattico:
 * Scopo del file: orchestrazione sottile delle scritture scan per le route API v1 canali/video.
 * Moduli richiamati: `@/lib/services/channels`, `@/lib/supabase/types`.
 * Flusso: le route validano input e auth, delegano qui accodamento job ed eventuale scan iniziale, poi mappano il risultato in envelope.
 */

import {
  addChannelForUser,
  enqueueScanJobForUser,
  runScanJob,
} from '@/lib/services/channels'
import type { AppSupabaseClient } from '@/lib/supabase/types'

export type QueuedScan = {
  jobId: string | null
  deduplicated: boolean
  background: (() => Promise<void>) | null
}

type ScanSource = 'manual_scan' | 'import_channel' | 'add_channel'

// Costruisce il task background che esegue lo scan dopo la risposta API.
// Gli errori restano registrati sul job; la risposta e` gia` stata consegnata.
function buildScanBackground(params: { userId: string; channelId: string; jobId: string; maxResults?: number }): () => Promise<void> {
  return async () => {
    try {
      await runScanJob({ userId: params.userId, channelId: params.channelId, jobId: params.jobId, maxResults: params.maxResults })
    } catch {
      // Il job registra lo stato failed; nessuna azione sulla risposta API.
    }
  }
}

// Accoda uno scan per un canale gia` di proprieta` dell'utente e prepara il background.
export async function queueChannelScan(params: {
  userId: string
  channelId: string
  supabase: AppSupabaseClient
  source: ScanSource
  maxResults?: number
  dedupeKey?: string
}): Promise<QueuedScan> {
  const result = await enqueueScanJobForUser(
    { userId: params.userId, channelId: params.channelId },
    { supabase: params.supabase, source: params.source, maxResults: params.maxResults, dedupeKey: params.dedupeKey }
  )
  if (!result.jobId || result.deduplicated) {
    return { jobId: result.jobId, deduplicated: result.deduplicated, background: null }
  }
  return {
    jobId: result.jobId,
    deduplicated: result.deduplicated,
    background: buildScanBackground({ userId: params.userId, channelId: params.channelId, jobId: result.jobId, maxResults: params.maxResults }),
  }
}

// Aggiunge un canale all'utente e accoda lo scan iniziale con dedup anti-spam.
export async function addChannelAndQueueScan(params: {
  userId: string
  channelUrl: string
  markExistingVideosAsSeen?: boolean
  supabase: AppSupabaseClient
  maxResults?: number
  dedupeKey?: string
}): Promise<{ channel: Awaited<ReturnType<typeof addChannelForUser>>; scan: QueuedScan }> {
  const channel = await addChannelForUser({
    userId: params.userId,
    channelUrl: params.channelUrl,
    markExistingVideosAsSeen: params.markExistingVideosAsSeen,
    supabase: params.supabase,
    deferInitialScan: true,
  })
  const scan = await queueChannelScan({
    userId: params.userId,
    channelId: channel.channelId,
    supabase: params.supabase,
    source: 'add_channel',
    maxResults: params.maxResults,
    dedupeKey: params.dedupeKey,
  })
  return { channel, scan }
}
