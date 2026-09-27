/* Commento didattico:
 * Scopo: route temporanea per due prove Gemini con persistenza canonica nel progetto Vercel DEV isolato.
 * Moduli richiamati: handler HTTP interno e runner server-only.
 * Flusso: delega autorizzazione e batch idempotente a due video al controller temporaneo DEV.
 */

import { handleGeminiAnalysisProbeRequest } from '@/lib/services/gemini-analysis-probe-handler'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  return handleGeminiAnalysisProbeRequest(request)
}
