/* Commento didattico:
 * Scopo: adapter HTTP temporaneo per il probe Gemini DEV.
 * Moduli richiamati: response envelope e runner server-side gemini-analysis-probe.
 * Flusso: autorizza solo DEV e token temporaneo, inoltra il batch e mappa risultato/diagnostica senza cache.
 */

import { apiErr, apiOk } from '@/lib/http/apiResponse'
import { getRequestId } from '@/lib/security/http'
import {
  claimGeminiProbeInThisRuntime,
  executeGeminiAnalysisProbeBatch,
  isGeminiProbeAuthorized,
  isGeminiProbeDevDeployment,
  type GeminiProbeBatchDiagnostics,
} from '@/lib/services/gemini-analysis-probe'

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function addProbeDiagnostics(response: Response, diagnostics?: GeminiProbeBatchDiagnostics): Response {
  if (!diagnostics) return response
  if (diagnostics.jobId) response.headers.set('X-Probe-Job-ID', diagnostics.jobId)
  const analysisIds = diagnostics.analysisIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (analysisIds.length > 0) response.headers.set('X-Probe-Analysis-IDs', analysisIds.join(','))
  if (diagnostics.completedAnalysisIds) response.headers.set('X-Probe-Completed-Count', String(diagnostics.completedAnalysisIds.length))
  if (diagnostics.failedAnalysisIds) response.headers.set('X-Probe-Failed-Count', String(diagnostics.failedAnalysisIds.length))
  if (diagnostics.unattemptedAnalysisRowsDeleted !== undefined) response.headers.set('X-Probe-Unattempted-Cleanup', String(diagnostics.unattemptedAnalysisRowsDeleted))
  if (diagnostics.failedAnalysisRowsRecorded !== undefined) response.headers.set('X-Probe-Failed-State-Recorded', String(diagnostics.failedAnalysisRowsRecorded))
  if (diagnostics.localizedContentDeleted !== undefined) response.headers.set('X-Probe-Rollback-Content', String(diagnostics.localizedContentDeleted))
  if (diagnostics.analysisRowsDeleted !== undefined) response.headers.set('X-Probe-Rollback-Analysis', String(diagnostics.analysisRowsDeleted))
  if (diagnostics.auditRecorded !== undefined) response.headers.set('X-Probe-Audit-Recorded', String(diagnostics.auditRecorded))
  return response
}

export async function handleGeminiAnalysisProbeRequest(request: Request): Promise<Response> {
  const requestId = getRequestId(request)
  if (!isGeminiProbeDevDeployment()) return noStore(apiErr('FORBIDDEN', 'Probe disponibile solo sul deployment DEV', 403, requestId))
  if (!isGeminiProbeAuthorized(request)) return noStore(apiErr('UNAUTHORIZED', 'Probe non autorizzato', 401, requestId))
  if (!claimGeminiProbeInThisRuntime()) return noStore(apiErr('RATE_LIMITED', 'Prova già avviata in questo runtime', 429, requestId))

  const result = await executeGeminiAnalysisProbeBatch()
  if (result.ok) return noStore(apiOk(result, requestId))

  const noCandidates = result.failure === 'two_eligible_videos_unavailable'
  const alreadyRun = result.failure === 'probe_batch_already_claimed'
  const response = apiErr(
    noCandidates ? 'NOT_FOUND' : alreadyRun ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
    noCandidates ? 'Non sono disponibili due video DEV idonei; nessuna chiamata Gemini è stata eseguita.' : 'La prova Gemini non è stata completata.',
    result.httpStatus ?? (noCandidates ? 404 : alreadyRun ? 429 : 502),
    requestId
  )
  addProbeDiagnostics(response, result.diagnostics)
  if (Number.isInteger(result.httpStatus) && result.httpStatus! >= 100 && result.httpStatus! <= 599) {
    response.headers.set('X-Upstream-Status', String(result.httpStatus))
  }
  const providerCode = String(result.providerErrorCode ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)
  if (providerCode) response.headers.set('X-Upstream-Error-Code', providerCode)
  return noStore(response)
}
