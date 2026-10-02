/* Commento didattico:
 * Scopo: route interna usa-e-getta per la singola prova Gemini DEV del 2026-10-02-1400.
 * Moduli richiamati: service one-shot Gemini e NextResponse.
 * Flusso: GET verifica readiness/readback senza provider; POST autentica il token temporaneo e avvia al massimo una prova.
 */

import { NextResponse } from 'next/server'
import {
  claimSingleProbeInThisRuntime,
  executeGeminiSingleProbe,
  getGeminiSingleProbeReadiness,
  getGeminiSingleProbeReadback,
  isSingleProbeAuthorized,
  isSingleProbeDevDeployment,
} from '@/lib/services/gemini-single-probe-20261002-1400'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unavailable() {
  return NextResponse.json({ ok: false, failure: 'probe_unavailable' }, { status: 404 })
}

function unauthorized() {
  return NextResponse.json({ ok: false, failure: 'unauthorized' }, { status: 401 })
}

export async function GET(request: Request) {
  if (!isSingleProbeDevDeployment()) return unavailable()
  if (!isSingleProbeAuthorized(request)) return unauthorized()

  try {
    const readback = await getGeminiSingleProbeReadback()
    const result = readback ?? await getGeminiSingleProbeReadiness()
    return NextResponse.json(result, { status: result.ok || result.mode === 'readback' ? 200 : 409 })
  } catch {
    return NextResponse.json({ ok: false, mode: 'ready', ready: false, failure: 'readiness_check_failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!isSingleProbeDevDeployment()) return unavailable()
  if (!isSingleProbeAuthorized(request)) return unauthorized()
  if (!claimSingleProbeInThisRuntime()) {
    return NextResponse.json({ ok: false, failure: 'probe_already_claimed' }, { status: 409 })
  }

  try {
    const result = await executeGeminiSingleProbe()
    const status = result.ok ? 200 : result.httpStatus ?? (result.failure === 'single_probe_already_claimed' ? 409 : 502)
    return NextResponse.json(result, { status })
  } catch {
    return NextResponse.json({ ok: false, failure: 'probe_execution_failed' }, { status: 500 })
  }
}
