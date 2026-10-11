/* Commento didattico:
 * Scopo del file: cron protetto che avanza job persistenti di verifica credenziali senza loop lunghi.
 * Moduli richiamati: timingSafeEqual, service job validation e attempt provider same-key.
 * Flusso: valida CRON_SECRET e processa un batch tecnico di lease, una richiesta provider per lease.
 */

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getRequestId } from '@/lib/security/http'
import { processPendingCredentialValidationJobs } from '@/lib/services/credential-validation-jobs'
import { performCredentialValidationAttempt } from '@/lib/services/integrations'

export const runtime = 'nodejs'
export const maxDuration = 30

/** Avanza job pending/due e recupera lease scadute senza azzerare i job_attempts. */
export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization') ?? ''
  const expected = secret ? `Bearer ${secret}` : ''
  const receivedBuffer = Buffer.from(authorization, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const authorized = Boolean(secret)
    && receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer)

  if (!authorized) {
    return NextResponse.json({ success: false, error: 'Unauthorized', requestId }, { status: secret ? 401 : 500 })
  }

  try {
    const result = await processPendingCredentialValidationJobs({
      attemptProvider: performCredentialValidationAttempt,
    })
    return NextResponse.json({ success: true, data: result, error: null, requestId })
  } catch {
    return NextResponse.json({ success: false, error: 'Errore interno', requestId }, { status: 500 })
  }
}
