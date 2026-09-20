/* Commento didattico:
 * Scopo del file: implementa flusso cancellazione account con grace period, annullamento token e esecuzione cron/admin.
 * Moduli richiamati: `node:crypto`, `@/lib/supabase/admin`, `@/lib/view-models/deletion`, `@/lib/env/getSiteUrl`.
 * Flusso: route utente/admin/cron delegano qui per request/cancel/execute/force-delete e audit coerente.
 */

import { createHmac, randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteUrl } from '@/lib/env/getSiteUrl'
import type { DeletionRequestView } from '@/lib/view-models/deletion'

const GRACE_DAYS = 30

function requireDeletionSecret(): string {
  const secret = process.env.SUPERADMIN_SESSION_SECRET?.trim()
  if (!secret) {
    throw new Error('SUPERADMIN_SESSION_SECRET mancante per firma token cancellazione')
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
  if (!payload || !signature || sign(payload, secret) !== signature) {
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
}): Promise<{ scheduledFor: string; cancelUrl: string }> {
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
      cancelUrl: buildSiteUrl(`/api/account/cancel-deletion?token=${encodeURIComponent(token)}`),
    }
  }

  const { data: created, error: createError } = await supabase
    .from('user_deletion_requests')
    .insert({
      user_id: params.userId,
      reason: params.reason,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
      scheduled_deletion_at: scheduledFor,
      status: 'pending',
    })
    .select('id, scheduled_deletion_at')
    .single()

  if (createError || !created) {
    throw new Error(createError?.message ?? 'Errore creazione richiesta cancellazione')
  }

  const { error: suspendError } = await supabase
    .from('users')
    .update({ status: 'suspended' })
    .eq('id', params.userId)

  if (suspendError) {
    throw new Error(`Errore sospensione utente: ${suspendError.message}`)
  }

  const token = createCancelDeletionToken(params.userId, created.id, created.scheduled_deletion_at)
  const cancelUrl = buildSiteUrl(`/api/account/cancel-deletion?token=${encodeURIComponent(token)}`)

  await supabase.from('app_logs').insert({
    level: 'info',
    message: 'account_deletion_requested',
    context: {
      user_id: params.userId,
      user_email: params.userEmail,
      scheduled_for: created.scheduled_deletion_at,
      cancel_url: cancelUrl,
    },
  })

  return {
    scheduledFor: created.scheduled_deletion_at,
    cancelUrl,
  }
}

export async function cancelDeletion(token: string): Promise<void> {
  const payload = verifyCancelDeletionToken(token)
  const supabase = createAdminClient()

  const { error: updateError } = await supabase
    .from('user_deletion_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', payload.requestId)
    .eq('user_id', payload.userId)
    .eq('status', 'pending')

  if (updateError) {
    throw new Error(`Errore annullamento cancellazione: ${updateError.message}`)
  }

  const { error: restoreError } = await supabase
    .from('users')
    .update({ status: 'active' })
    .eq('id', payload.userId)

  if (restoreError) {
    throw new Error(`Errore riattivazione utente: ${restoreError.message}`)
  }
}

export async function executeDeletion(requestId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: request, error: requestError } = await supabase
    .from('user_deletion_requests')
    .select('id, user_id, status')
    .eq('id', requestId)
    .maybeSingle()

  if (requestError || !request?.user_id) {
    throw new Error(requestError?.message ?? 'Richiesta cancellazione non trovata')
  }

  if (request.status !== 'pending' && request.status !== 'executing') {
    return
  }

  await supabase.from('user_deletion_requests').update({ status: 'executing' }).eq('id', request.id)

  const { error: rpcError } = await supabase.rpc('execute_user_deletion', { p_user_id: request.user_id })
  if (rpcError) {
    await supabase
      .from('user_deletion_requests')
      .update({ status: 'failed', error_details: rpcError.message })
      .eq('id', request.id)
    throw new Error(`Errore execute_user_deletion: ${rpcError.message}`)
  }

  await supabase
    .from('user_deletion_requests')
    .update({ status: 'completed', executed_at: new Date().toISOString() })
    .eq('id', request.id)
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
      user_id: userId,
      admin_username: adminUsername,
      reason,
      executed_at: new Date().toISOString(),
    },
  })
}

export async function processPendingDeletionRequests(nowIso = new Date().toISOString()): Promise<{ processed: number; failed: number }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('user_deletion_requests')
    .select('id')
    .eq('status', 'pending')
    .lte('scheduled_deletion_at', nowIso)

  if (error) {
    throw new Error(`Errore query richieste pendenti: ${error.message}`)
  }

  let processed = 0
  let failed = 0

  for (const item of data ?? []) {
    try {
      await executeDeletion(item.id)
      processed += 1
    } catch {
      failed += 1
    }
  }

  return { processed, failed }
}
