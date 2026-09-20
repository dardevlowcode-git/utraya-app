/* Commento didattico:
 * Scopo del file: endpoint admin per pulizia reale dei log per categoria.
 * Moduli richiamati: `next/server`, `@/lib/auth/admin`, `@/lib/supabase/admin`, `@/lib/utils/errors`, `@/lib/security/http`
 * Flusso: valida sessione super-admin e richiesta same-origin JSON, poi elimina dal DB i record della categoria selezionata.
 */

import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getRequestId } from '@/lib/security/http'

type CleanupType = 'failed_jobs' | 'app_logs' | 'audit_logs'

function isCleanupType(value: unknown): value is CleanupType {
  return value === 'failed_jobs' || value === 'app_logs' || value === 'audit_logs'
}

export async function POST(request: Request) {
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

  let cleanupType: CleanupType
  try {
    const payload = (await request.json()) as { type?: unknown }
    if (!isCleanupType(payload?.type)) {
      return errorResponse('Tipo cleanup non valido', 'validation', 400, requestId)
    }
    cleanupType = payload.type
  } catch {
    return errorResponse('Body JSON non valido', 'validation', 400, requestId)
  }

  const supabase = createAdminClient()

  if (cleanupType === 'app_logs') {
    const { count } = await supabase
      .from('app_logs')
      .select('id', { count: 'exact', head: true })
      .not('id', 'is', null)

    const { error } = await supabase
      .from('app_logs')
      .delete()
      .not('id', 'is', null)

    if (error) {
      return errorResponse('Errore durante la pulizia app logs', 'unknown', 500, requestId)
    }

    return NextResponse.json({
      data: {
        message: `Pulizia completata: eliminati ${count ?? 0} log applicazione.`,
        cleanupType,
        deletedCount: count ?? 0,
      },
      error: null,
      errorType: null,
      errorCode: null,
      requestId,
    })
  }

  if (cleanupType === 'audit_logs') {
    const { count } = await supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .not('id', 'is', null)

    const { error } = await supabase
      .from('audit_logs')
      .delete()
      .not('id', 'is', null)

    if (error) {
      return errorResponse('Errore durante la pulizia audit logs', 'unknown', 500, requestId)
    }

    return NextResponse.json({
      data: {
        message: `Pulizia completata: eliminati ${count ?? 0} audit log.`,
        cleanupType,
        deletedCount: count ?? 0,
      },
      error: null,
      errorType: null,
      errorCode: null,
      requestId,
    })
  }

  const [{ count: failedAttemptsCount }, { count: failedJobsCount }] = await Promise.all([
    supabase
      .from('job_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed'),
  ])

  const { error: deleteAttemptsError } = await supabase
    .from('job_attempts')
    .delete()
    .eq('status', 'failed')

  if (deleteAttemptsError) {
    return errorResponse('Errore durante la pulizia tentativi falliti', 'unknown', 500, requestId)
  }

  const { error: deleteJobsError } = await supabase
    .from('jobs')
    .delete()
    .eq('status', 'failed')

  if (deleteJobsError) {
    return errorResponse('Errore durante la pulizia job falliti', 'unknown', 500, requestId)
  }

  return NextResponse.json({
    data: {
      message: `Pulizia completata: eliminati ${failedJobsCount ?? 0} job falliti e ${failedAttemptsCount ?? 0} tentativi falliti.`,
      cleanupType,
      deletedFailedJobs: failedJobsCount ?? 0,
      deletedFailedAttempts: failedAttemptsCount ?? 0,
    },
    error: null,
    errorType: null,
    errorCode: null,
    requestId,
  })
}

