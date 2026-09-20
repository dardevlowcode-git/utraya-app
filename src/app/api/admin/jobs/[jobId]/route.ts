/* Commento didattico:
 * Scopo del file: gestisce una API route: riceve richieste HTTP, valida i dati e restituisce una risposta al frontend.
 * Moduli richiamati: `next/server`, `@/lib/supabase/admin`, `@/lib/auth/admin`
 * Flusso: La route viene richiamata dal client (o da altre parti server), usa servizi/utilita` in `src/lib` e poi ritorna JSON/HTTP status.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminSession } from '@/lib/auth/admin'
import { buildJobLabel, collectJobChannelIds, collectJobUserIds } from '@/lib/utils/job-label'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getClientIp, getRequestId } from '@/lib/security/http'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Retry di un job fallito: crea una nuova riga job `pending` con payload ereditato.
 */
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }

  const adminSession = await getAdminSession()
  if (!adminSession) {
    return errorResponse('Unauthorized', 'unauthorized', 401, requestId)
  }

  const { jobId: rawJobId } = await context.params
  const jobId = rawJobId?.trim()
  if (!jobId || !uuidPattern.test(jobId)) {
    return errorResponse('jobId non valido', 'validation', 400, requestId)
  }

  const supabase = createAdminClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, status, job_type, priority, payload, created_by_user_id, deduplication_key')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError) {
    return errorResponse('Errore lettura job', 'unknown', 500, requestId)
  }

  if (!job) {
    return errorResponse('Job non trovato', 'not_found', 404, requestId)
  }

  // Il retry e consentito solo da stato failed per evitare duplicazioni non volute.
  if (job.status !== 'failed') {
    return errorResponse('Si possono riprovare solo job in stato failed', 'validation', 409, requestId)
  }

  const retryDedupKey = `${job.deduplication_key ?? `admin-retry-${job.id}`}:retry:${Date.now()}`
  const nowIso = new Date().toISOString()

  const { data: retriedJob, error: insertError } = await supabase
    .from('jobs')
    .insert({
      job_type: job.job_type,
      status: 'pending',
      priority: job.priority,
      payload: job.payload,
      deduplication_key: retryDedupKey,
      created_by_user_id: job.created_by_user_id,
      created_at: nowIso,
      started_at: null,
      completed_at: null,
      error_message: null,
    })
    .select('id, job_type, status, priority, created_at, error_message')
    .single()

  if (insertError) {
    return errorResponse('Errore creazione retry job', 'unknown', 500, requestId)
  }

  const labelSource = [{
    id: retriedJob.id,
    created_by_user_id: job.created_by_user_id,
    payload: job.payload,
  }]
  const userIds = collectJobUserIds(labelSource)
  const channelIds = collectJobChannelIds(labelSource)
  const [usersResult, channelsResult] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string }> })
      : supabase.from('users').select('id, display_name, email').in('id', userIds),
    channelIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; title: string }> })
      : supabase.from('channels').select('id, title').in('id', channelIds),
  ])
  const usersById = Object.fromEntries((usersResult.data ?? []).map((u) => [u.id, u.display_name ?? u.email]))
  const channelsById = Object.fromEntries((channelsResult.data ?? []).map((c) => [c.id, c.title]))
  const retriedJobLabel = buildJobLabel(labelSource[0], usersById, channelsById)

  await supabase.from('audit_logs').insert({
    user_id: null,
    action: 'admin_retry_failed_job',
    resource_type: 'job',
    resource_id: jobId,
    ip_address: getClientIp(request),
    details: {
      admin_username: adminSession.username,
      retried_job_id: retriedJob.id,
      request_id: requestId,
    },
  })

  return NextResponse.json({
    data: {
      message: 'Job riaccodato correttamente',
      sourceJobId: jobId,
      retriedJob: {
        ...retriedJob,
        job_label: retriedJobLabel,
      },
    },
    error: null,
    errorType: null,
    errorCode: null,
    requestId,
  })
}

/**
 * Elimina un job solo se ancora `pending`.
 */
export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const requestId = getRequestId(request)
  try {
    ensureSameOrigin(request)
    ensureJsonRequest(request)
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }

  const adminSession = await getAdminSession()
  if (!adminSession) {
    return errorResponse('Unauthorized', 'unauthorized', 401, requestId)
  }

  const { jobId: rawJobId } = await context.params
  const jobId = rawJobId?.trim()
  if (!jobId || !uuidPattern.test(jobId)) {
    return errorResponse('jobId non valido', 'validation', 400, requestId)
  }

  const supabase = createAdminClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError) {
    return errorResponse('Errore lettura job', 'unknown', 500, requestId)
  }

  if (!job) {
    return errorResponse('Job non trovato', 'not_found', 404, requestId)
  }

  // Per sicurezza permettiamo la cancellazione solo dei job realmente in coda.
  if (job.status !== 'pending') {
    return errorResponse('Si possono eliminare solo job in stato pending', 'validation', 409, requestId)
  }

  const { error: deleteError } = await supabase
    .from('jobs')
    .delete()
    .eq('id', jobId)

  if (deleteError) {
    return errorResponse('Errore eliminazione job', 'unknown', 500, requestId)
  }

  await supabase.from('audit_logs').insert({
    user_id: null,
    action: 'admin_delete_pending_job',
    resource_type: 'job',
    resource_id: jobId,
    ip_address: getClientIp(request),
    details: { admin_username: adminSession.username, request_id: requestId },
  })

  return NextResponse.json({
    data: { message: 'Job in coda eliminato correttamente', jobId },
    error: null,
    errorType: null,
    errorCode: null,
    requestId,
  })
}
