/* Commento didattico:
 * Scopo del file: implementa flusso cancellazione account con grace period, annullamento token e esecuzione cron/admin.
 * Moduli richiamati: `node:crypto`, `@/lib/supabase/admin`, `@/lib/view-models/deletion`, `@/lib/env/getSiteUrl`.
 * Flusso: route utente/admin/cron delegano qui per request/cancel/execute/force-delete e audit coerente.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteUrl } from '@/lib/env/getSiteUrl'
import type { DeletionRequestView } from '@/lib/view-models/deletion'

const GRACE_DAYS = 30

function requireDeletionSecret(): string {
  const secret = process.env.ACCOUNT_DELETION_TOKEN_SECRET?.trim()
  if (!secret) {
    throw new Error('ACCOUNT_DELETION_TOKEN_SECRET mancante per firma token cancellazione')
  }
  return secret
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createCancelDeletionToken(userId: string, requestId: string, expiresAt: string): string {
  const secret = requireDeletionSecret()
  const payload = toBase64Url(
    JSON.stringify({ purpose: 'cancel_deletion', userId, requestId, exp: new Date(expiresAt).getTime(), nonce: randomBytes(8).toString('hex') })
  )
  return `${payload}.${sign(payload, secret)}`
}

function verifyCancelDeletionToken(token: string): { userId: string; requestId: string } {
  const secret = requireDeletionSecret()
  const [payload, signature] = token.split('.')
  const expectedSignature = payload ? sign(payload, secret) : ''
  const receivedBuffer = Buffer.from(signature ?? '', 'utf8')
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
  if (!payload || !signature || receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    throw new Error('Token cancellazione non valido')
  }

  const parsed = JSON.parse(fromBase64Url(payload)) as {
    purpose?: string
    userId?: string
    requestId?: string
    exp?: number
  }

  if (parsed.purpose !== 'cancel_deletion' || !parsed.userId || !parsed.requestId || typeof parsed.exp !== 'number') {
    throw new Error('Token cancellazione malformato')
  }

  if (Date.now() > parsed.exp) {
    throw new Error('Token cancellazione scaduto')
  }

  return { userId: parsed.userId, requestId: parsed.requestId }
}

export function getCancelDeletionTokenOwner(token: string): string {
  return verifyCancelDeletionToken(token).userId
}

export async function getDeletionRequestView(userId: string): Promise<DeletionRequestView> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('user_deletion_requests')
    .select('id, status, requested_at, scheduled_deletion_at')
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) {
    return {
      status: 'none',
      scheduledFor: null,
      requestedAt: null,
      canCancel: false,
      daysRemaining: null,
      cancelToken: null,
    }
  }

  const scheduled = data.scheduled_deletion_at ? new Date(data.scheduled_deletion_at) : null
  const now = Date.now()
  const daysRemaining = scheduled ? Math.max(0, Math.ceil((scheduled.getTime() - now) / (1000 * 60 * 60 * 24))) : null
  const isPending = data.status === 'pending'

  return {
    status: (data.status as DeletionRequestView['status']) ?? 'none',
    requestedAt: data.requested_at,
    scheduledFor: data.scheduled_deletion_at,
    canCancel: isPending,
    daysRemaining,
    cancelToken: isPending && data.scheduled_deletion_at ? createCancelDeletionToken(userId, data.id, data.scheduled_deletion_at) : null,
  }
}

export async function isDeletionPending(userId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('user_deletion_requests')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle()

  return Boolean(data)
}

export async function requestDeletion(params: {
  userId: string
  userEmail: string
  reason: string | null
  ipAddress: string | null
  userAgent: string | null
  requestId?: string
  cancelPath?: string
}): Promise<{ scheduledFor: string; cancelUrl: string; cancelToken: string }> {
  const supabase = createAdminClient()
  const scheduledFor = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: existing } = await supabase
    .from('user_deletion_requests')
    .select('id, scheduled_deletion_at')
    .eq('user_id', params.userId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    const token = createCancelDeletionToken(params.userId, existing.id, existing.scheduled_deletion_at)
    return {
      scheduledFor: existing.scheduled_deletion_at,
      cancelUrl: buildSiteUrl(`${params.cancelPath ?? '/api/account/cancel-deletion'}?token=${encodeURIComponent(token)}`),
      cancelToken: token,
    }
  }

  const { data: rpcRows, error: createError } = await supabase.rpc('request_account_deletion', {
    p_user_id: params.userId,
    p_reason: params.reason,
    p_ip_address: params.ipAddress,
    p_user_agent: params.userAgent,
    p_scheduled_at: scheduledFor,
  })
  const created = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
  if (createError || !created?.request_id || !created.scheduled_for) {
    throw new Error(createError?.message ?? 'Errore creazione richiesta cancellazione')
  }

  const token = createCancelDeletionToken(params.userId, created.request_id, created.scheduled_for)
  const cancelUrl = buildSiteUrl(`${params.cancelPath ?? '/api/account/cancel-deletion'}?token=${encodeURIComponent(token)}`)

  await supabase.from('app_logs').insert({
    level: 'info',
    message: 'account_deletion_requested',
    context: {
      user_id_hash: createHash('sha256').update(params.userId).digest('hex').slice(0, 16),
       scheduled_for: created.scheduled_for,
      request_id: params.requestId ?? null,
    },
  })

  return {
    scheduledFor: created.scheduled_for,
    cancelUrl,
    cancelToken: token,
  }
}

export async function cancelDeletion(token: string): Promise<boolean> {
  const payload = verifyCancelDeletionToken(token)
  const supabase = createAdminClient()

  const { data: restored, error } = await supabase.rpc('cancel_account_deletion', {
    p_user_id: payload.userId,
    p_request_id: payload.requestId,
  })
  if (error) throw new Error(`Errore annullamento cancellazione: ${error.message}`)
  return restored === true
}

export async function executeDeletion(requestId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: claimed, error: claimError } = await supabase.rpc('claim_account_deletion', { p_request_id: requestId })
  if (claimError) throw new Error(`Errore acquisizione cancellazione: ${claimError.message}`)
  if (!claimed) return

  const { data: request, error: requestError } = await supabase
    .from('user_deletion_requests')
    .select('id, user_id')
    .eq('id', requestId)
    .maybeSingle()

  if (requestError || !request?.user_id) {
    throw new Error(requestError?.message ?? 'Richiesta cancellazione non trovata')
  }

  const { error: rpcError } = await supabase.rpc('execute_user_deletion', { p_user_id: request.user_id })
  if (rpcError) {
    const { error: failureUpdateError } = await supabase
      .from('user_deletion_requests')
      .update({ status: 'failed', executing_at: null, error_details: rpcError.message })
      .eq('id', request.id)
    if (failureUpdateError) throw new Error(`Errore execute_user_deletion: ${rpcError.message}; impossibile registrare failure: ${failureUpdateError.message}`)
    throw new Error(`Errore execute_user_deletion: ${rpcError.message}`)
  }

  const { error: completionUpdateError } = await supabase
    .from('user_deletion_requests')
    .update({ status: 'completed', executing_at: null, executed_at: new Date().toISOString() })
    .eq('id', request.id)
  if (completionUpdateError) throw new Error(`Cancellazione completata ma stato richiesta non aggiornato: ${completionUpdateError.message}`)
}

export async function forceDeleteUser(userId: string, adminUsername: string, reason: string): Promise<void> {
  const supabase = createAdminClient()
  const { error: rpcError } = await supabase.rpc('execute_user_deletion', { p_user_id: userId })
  if (rpcError) {
    throw new Error(`Errore force delete: ${rpcError.message}`)
  }

  await supabase.from('app_logs').insert({
    level: 'warn',
    message: 'force_delete_user',
    context: {
      user_id_hash: createHash('sha256').update(userId).digest('hex').slice(0, 16),
      admin_username: adminUsername,
      reason,
      executed_at: new Date().toISOString(),
    },
  })
}

export async function processPendingDeletionRequests(nowIso = new Date().toISOString()): Promise<{ processed: number; failed: number }> {
  const supabase = createAdminClient()
  const staleExecutingBefore = new Date(new Date(nowIso).getTime() - 15 * 60 * 1000).toISOString()
  const [{ data: pending, error: pendingError }, { data: staleExecuting, error: staleError }] = await Promise.all([
    supabase
      .from('user_deletion_requests')
      .select('id')
      .eq('status', 'pending')
      .lte('scheduled_deletion_at', nowIso),
    supabase
      .from('user_deletion_requests')
      .select('id')
      .eq('status', 'executing')
      .lt('executing_at', staleExecutingBefore),
  ])

  if (pendingError || staleError) {
    throw new Error(`Errore query richieste cancellazione: ${pendingError?.message ?? staleError?.message}`)
  }

  let processed = 0
  let failed = 0

  for (const item of [...(pending ?? []), ...(staleExecuting ?? [])]) {
    try {
      await executeDeletion(item.id)
      processed += 1
    } catch {
      failed += 1
    }
  }

  return { processed, failed }
}
