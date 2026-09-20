/* Commento didattico:
 * Scopo del file: endpoint cron giornaliero compatibile Vercel per avviare il daily sync dei canali.
 * Moduli richiamati: `next/server`, `@/lib/services/daily-sync`, `@/lib/utils/errors`
 * Flusso: valida Authorization Bearer con CRON_SECRET, delega al service e restituisce un riepilogo JSON.
 */

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { runDailyChannelSync } from '@/lib/services/daily-sync'
import { AppError } from '@/lib/utils/errors'
import { getRequestId } from '@/lib/security/http'

/**
 * Trigger HTTP del job giornaliero.
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request)
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Errore interno',
        errorType: 'structural',
        errorCode: 'misconfigured_cron',
        requestId,
      },
      { status: 500 }
    )
  }

  const authorization = request.headers.get('authorization')
  const expected = `Bearer ${secret}`
  const receivedBuffer = Buffer.from(authorization ?? '', 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')

  const isAuthorized = receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer)

  if (!isAuthorized) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Unauthorized',
        errorType: 'unauthorized',
        errorCode: 'unauthorized',
        requestId,
      },
      { status: 401 }
    )
  }

  try {
    const result = await runDailyChannelSync()

    return NextResponse.json(
      {
        success: result.success,
        data: result,
        error: null,
        errorType: null,
        errorCode: null,
        requestId,
      },
      { status: result.success ? 200 : 207 }
    )
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: 'Errore interno',
          errorType: error.type,
          errorCode: 'daily_sync_failed',
          requestId,
        },
        { status: error.statusCode ?? 500 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: 'Errore interno',
        errorType: 'unknown',
        errorCode: 'internal_error',
        requestId,
      },
      { status: 500 }
    )
  }
}
