/* Commento didattico:
 * Scopo: route interna usa-e-getta per la prova Gemini DEV 2026-10-02-1600.
 * Moduli richiamati: service mono-video e NextResponse.
 * Flusso: GET autenticata controlla readback/readiness senza provider; POST autenticata avvia una sola prova.
 */

import { NextResponse } from 'next/server'
import {
  claimSingleProbeInThisRuntime,
  executeGeminiSingleProbe,
  getGeminiSingleProbeReadiness,
  getGeminiSingleProbeReadback,
  isSingleProbeAuthorized,
  isSingleProbeDevDeployment,
} from '@/lib/services/gemini-single-probe-20261002-1600'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unavailable() {
  return noStoreJson({ ok: false, failure: 'probe_unavailable' }, 404)
}

function unauthorized() {
  return noStoreJson({ ok: false, failure: 'unauthorized' }, 401)
}

function noStoreJson(body: unknown, status: number) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: Request) {
  if (!isSingleProbeDevDeployment()) return unavailable()
  if (!isSingleProbeAuthorized(request)) return unauthorized()

  try {
    const readback = await getGeminiSingleProbeReadback()
    const result = readback ?? await getGeminiSingleProbeReadiness()
    return noStoreJson(result, result.ok ? 200 : 409)
  } catch {
    return noStoreJson({ ok: false, mode: 'ready', ready: false, failure: 'readiness_check_failed' }, 500)
  }
}

export async function POST(request: Request) {
  if (!isSingleProbeDevDeployment()) return unavailable()
  if (!isSingleProbeAuthorized(request)) return unauthorized()
  if (!claimSingleProbeInThisRuntime()) {
    return noStoreJson({ ok: false, failure: 'probe_already_claimed' }, 409)
  }

  try {
    const result = await executeGeminiSingleProbe()
    const status = result.ok ? 200 : result.httpStatus ?? (result.failure === 'single_probe_already_claimed' ? 409 : 502)
    return noStoreJson(result, status)
  } catch {
    return noStoreJson({ ok: false, failure: 'probe_execution_failed' }, 500)
  }
}
