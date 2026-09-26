/* Commento didattico:
 * Scopo del file: espone canali utente con contratto REST Bearer versionato per client mobili.
 * Moduli richiamati: `@/lib/http/apiV1`, `@/lib/services/channels`, `@/lib/http/apiResponse`.
 * Flusso: autentica token, verifica ownership nel service e restituisce solo il view model pubblico.
 */

import { apiOk } from '@/lib/http/apiResponse'
import { after } from 'next/server'
import { apiV1Error, apiV1Validation, getApiRequestId, readApiJson, requireApiJson, requireApiRateLimit, requireApiUser } from '@/lib/http/apiV1'
import {
  getChannelsForUser,
  removeChannelForUser,
} from '@/lib/services/channels'
import { addChannelAndQueueScan, queueChannelScan } from '@/lib/services/channel-scan-actions'
import { toChannelApiView } from '@/lib/view-models/channelApi'
import { z } from 'zod'

type ChannelBody = {
  action?: 'add' | 'scan_now'
  channelUrl?: string
  channelId?: string
  maxResults?: number
  markExistingVideosAsSeen?: boolean
}

const channelBodySchema = z.object({
  action: z.enum(['add', 'scan_now']).optional(),
  channelUrl: z.string().trim().max(2048).optional(),
  channelId: z.string().uuid().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
  markExistingVideosAsSeen: z.boolean().optional(),
}).strict()
const channelDeleteSchema = z.object({ channelId: z.string().uuid() }).strict()

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const channels = await getChannelsForUser(current.user.id, current.supabase)
    return apiOk(channels.map(toChannelApiView), requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}

export async function POST(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    requireApiJson(request)
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:channels:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<ChannelBody>(request, channelBodySchema)
    const action = body.action ?? 'add'

    if (action === 'scan_now') {
      if (!body.channelId?.trim()) return apiV1Validation('channelId obbligatorio', requestId)
      const scan = await queueChannelScan({ userId: current.user.id, channelId: body.channelId.trim(), supabase: current.supabase, source: 'manual_scan', maxResults: body.maxResults, dedupeKey: request.headers.get('idempotency-key') ?? undefined })
      if (scan.background) after(() => { void scan.background?.() })
      return apiOk({ jobId: scan.jobId, deduplicated: scan.deduplicated }, requestId, 202)
    }

    if (!body.channelUrl?.trim()) return apiV1Validation('channelUrl obbligatorio', requestId)
    const added = await addChannelAndQueueScan({ userId: current.user.id, channelUrl: body.channelUrl.trim(), markExistingVideosAsSeen: body.markExistingVideosAsSeen, supabase: current.supabase, maxResults: body.maxResults, dedupeKey: request.headers.get('idempotency-key') ?? undefined })
    if (added.scan.background) after(() => { void added.scan.background?.() })
    return apiOk({ ...added.channel, scan: { status: 'queued', jobId: added.scan.jobId, deduplicated: added.scan.deduplicated } }, requestId, 202)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}

export async function DELETE(request: Request) {
  const requestId = getApiRequestId(request)
  try {
    requireApiJson(request)
    const current = await requireApiUser(request, requestId)
    if (current instanceof Response) return current
    const limited = requireApiRateLimit(requestId, { key: `v1:channels:${current.user.id}` })
    if (limited) return limited
    const body = await readApiJson<{ channelId: string }>(request, channelDeleteSchema)
    if (!body.channelId?.trim()) return apiV1Validation('channelId obbligatorio', requestId)
    const result = await removeChannelForUser({ userId: current.user.id, channelId: body.channelId.trim(), supabase: current.supabase })
    return apiOk(result, requestId)
  } catch (error) {
    return apiV1Error(error, requestId)
  }
}
