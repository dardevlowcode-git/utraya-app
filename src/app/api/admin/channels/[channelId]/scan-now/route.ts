/* Commento didattico:
 * Scopo del file: endpoint admin per forzare una scansione canale immediata.
 * Moduli richiamati: `next/server`, `@/lib/auth/admin`, `@/lib/supabase/admin`, `@/lib/services/channels`, `@/lib/utils/errors`
 * Flusso: valida sessione super-admin, risolve un utente attivo per il canale e avvia la scansione senza attendere scheduler.
 */

import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth/admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { requestScanNowForUser } from '@/lib/services/channels'
import { AppError, errorResponse } from '@/lib/utils/errors'
import { ensureJsonRequest, ensureSameOrigin, getClientIp, getRequestId } from '@/lib/security/http'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Avvia una scansione canale immediata come super-admin.
 */
export async function POST(request: Request, context: { params: Promise<{ channelId: string }> }) {
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

  const { channelId: rawChannelId } = await context.params
  const channelId = rawChannelId?.trim()
  if (!channelId || !uuidPattern.test(channelId)) {
    return errorResponse('channelId non valido', 'validation', 400, requestId)
  }

  const supabase = createAdminClient()
  const { data: userChannel, error: userChannelError } = await supabase
    .from('user_channels')
    .select('user_id')
    .eq('channel_id', channelId)
    .eq('is_active', true)
    .order('added_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (userChannelError) {
    return errorResponse('Errore lookup canale', 'unknown', 500, requestId)
  }

  if (!userChannel?.user_id) {
    return errorResponse('Nessun utente attivo associato al canale', 'not_found', 404, requestId)
  }

  try {
    await requestScanNowForUser({ userId: userChannel.user_id, channelId }, { asAdmin: true })
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.type, error.statusCode ?? 500, requestId)
    }
    return errorResponse('Errore interno', 'unknown', 500, requestId)
  }

  await supabase.from('audit_logs').insert({
    user_id: null,
    action: 'admin_scan_now_channel',
    resource_type: 'channel',
    resource_id: channelId,
    ip_address: getClientIp(request),
    details: {
      admin_username: adminSession.username,
      user_id: userChannel.user_id,
      request_id: requestId,
    },
  })

  return NextResponse.json({
    data: {
      message: 'Scansione avviata',
      channelId,
      userId: userChannel.user_id,
    },
    error: null,
    errorType: null,
    errorCode: null,
    requestId,
  })
}
