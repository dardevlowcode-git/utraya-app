/* Commento didattico:
 * Scopo del file: normalizza e persiste diagnostica server-side dei fetch transcript.
 * Flusso: estrae solo campi allowlisted, rimuove URL/credenziali e scrive lo storico append-only.
 */

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type TranscriptDiagnosticClient = 'ANDROID' | 'TVHTML5'
export type TranscriptDiagnosticStage = 'configuration' | 'player' | 'timedtext'
export type TranscriptDiagnosticOutcome =
  | 'configuration_error'
  | 'http_error'
  | 'playability_blocked'
  | 'no_usable_track'
  | 'timeout'
  | 'network_error'
  | 'invalid_json'
  | 'timedtext_empty'
  | 'timedtext_error'
  | 'fetched'
  | 'unknown_error'

export interface TranscriptAttemptDiagnostic {
  fetch_run_id: string
  video_id: string
  request_id: string | null
  attempt_no: number
  client_name: TranscriptDiagnosticClient | null
  stage: TranscriptDiagnosticStage
  outcome: TranscriptDiagnosticOutcome
  player_http_status: number | null
  player_status_text: string | null
  player_content_type: string | null
  playability_status: string | null
  player_reason: string | null
  player_subreason: string | null
  player_error_code: string | null
  player_error_message: string | null
  track_count: number | null
  usable_track_count: number | null
  selected_track_language: string | null
  selected_track_kind: string | null
  timedtext_http_status: number | null
  timedtext_status_text: string | null
  timedtext_content_type: string | null
  player_duration_ms: number | null
  timedtext_duration_ms: number | null
  error_type: string | null
  error_code: string | null
  error_message: string | null
  attempt_started_at: string
  completed_at: string
}

export interface PlayerDiagnosticFields {
  playability_status: string | null
  player_reason: string | null
  player_subreason: string | null
  player_error_code: string | null
  player_error_message: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nested(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  return asRecord(record?.[key])
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  if (typeof record?.simpleText === 'string') return record.simpleText
  if (typeof record?.text === 'string') return record.text
  if (Array.isArray(record?.runs)) {
    const text = record.runs
      .map((run) => asRecord(run)?.text)
      .filter((part): part is string => typeof part === 'string')
      .join('')
    return text || null
  }
  return null
}

function codeValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return textValue(value)
}

/** Mantiene testo diagnostico utile ma non salva URL, query sensibili o control characters. */
export function sanitizeDiagnosticText(value: unknown, maxLength = 1024): string | null {
  if (typeof value !== 'string') return null

  const apiKey = process.env.YOUTUBEI_API_KEY?.trim()
  let sanitized = value
    .replace(/\r\n?/g, '\n')
    .replace(/["']?(authorization|proxy-authorization)["']?\s*[:=]\s*["']?[^"',;}\n]+/gi, '$1: [REDACTED]')
    .replace(/["']?(cookie|set-cookie)["']?\s*[:=]\s*["']?[^"',;}\n]+/gi, '$1: [REDACTED]')
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\n]*/gi, '$1: [REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client_secret|refresh_token|access_token|id_token|api[_-]?key|key|token|sig|signature|auth|sid|hsid|ssid|apisid|sapisid)\s*["']?\s*[:=]\s*["']?)[^"'&#;,\s}]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL REDACTED]')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (apiKey) sanitized = sanitized.split(apiKey).join('[REDACTED]')
  return sanitized ? sanitized.slice(0, maxLength) : null
}

/** Estrae campi noti dalla risposta player; non conserva mai il payload o le caption track. */
export function extractPlayerDiagnosticFields(payload: unknown): PlayerDiagnosticFields {
  const root = asRecord(payload)
  const playability = nested(root, 'playabilityStatus')
  const errorScreen = nested(playability, 'errorScreen')
  const renderer = nested(errorScreen, 'playerErrorMessageRenderer')
  const apiError = nested(root, 'error')

  const reason = textValue(playability?.reason) ?? textValue(renderer?.reason)
  const subreason = textValue(playability?.subreason) ?? textValue(renderer?.subreason)
  const message = textValue(renderer?.playerErrorMessage)
    ?? textValue(renderer?.reason)
    ?? textValue(playability?.reason)
    ?? textValue(apiError?.message)

  return {
    playability_status: sanitizeDiagnosticText(playability?.status, 100),
    player_reason: sanitizeDiagnosticText(reason),
    player_subreason: sanitizeDiagnosticText(subreason),
    player_error_code: sanitizeDiagnosticText(
      codeValue(errorScreen?.errorCode ?? renderer?.errorCode ?? apiError?.code ?? apiError?.status),
      100
    ),
    player_error_message: sanitizeDiagnosticText(message),
  }
}

export function classifyDiagnosticError(error: unknown): {
  outcome: 'timeout' | 'network_error'
  error_type: string
  error_code: string | null
  error_message: string | null
} {
  const record = asRecord(error)
  const cause = asRecord(record?.cause)
  const name = error instanceof Error ? error.name : 'UnknownError'
  const message = error instanceof Error ? error.message : String(error)
  const causeCode = typeof cause?.code === 'string' ? cause.code : null
  const timeout = /abort|timeout/i.test(`${name} ${message} ${causeCode ?? ''}`)

  return {
    outcome: timeout ? 'timeout' : 'network_error',
    error_type: sanitizeDiagnosticText(name, 100) ?? 'UnknownError',
    error_code: sanitizeDiagnosticText(causeCode, 100),
    error_message: sanitizeDiagnosticText(message),
  }
}

function runtimeMetadata() {
  return {
    runtime_environment: sanitizeDiagnosticText(process.env.VERCEL_ENV ?? process.env.NODE_ENV, 64),
    runtime_region: sanitizeDiagnosticText(process.env.VERCEL_REGION, 100),
    deployment_id: sanitizeDiagnosticText(process.env.VERCEL_DEPLOYMENT_ID, 200),
    git_commit_sha: sanitizeDiagnosticText(process.env.VERCEL_GIT_COMMIT_SHA, 64),
    git_commit_ref: sanitizeDiagnosticText(process.env.VERCEL_GIT_COMMIT_REF, 100),
    node_version: sanitizeDiagnosticText(process.version, 64),
  }
}

/**
 * Persiste lo storico solo per run che hanno almeno un'anomalia; include anche
 * gli eventuali tentativi successivi che hanno permesso di distinguere il fallback.
 * Il logger omette l'ID video e usa esclusivamente i campi già sanificati.
 */
export async function persistTranscriptDiagnostics(
  admin: AdminClient,
  attempts: TranscriptAttemptDiagnostic[]
): Promise<void> {
  if (attempts.length === 0 || attempts.every((attempt) => attempt.outcome === 'fetched')) return

  const rows = attempts.map((attempt) => ({ ...attempt, ...runtimeMetadata() }))
  for (const row of rows) {
    const { video_id: _videoId, ...safeLogRecord } = row
    console.info(JSON.stringify({ event: 'transcript_fetch_diagnostic', ...safeLogRecord }))
  }

  try {
    const { error } = await admin.from('transcript_fetch_diagnostics').insert(rows)
    if (error) throw error
  } catch (error) {
    const errorRecord = asRecord(error)
    console.error(JSON.stringify({
      event: 'transcript_diagnostic_persist_failed',
      fetch_run_id: attempts[0]?.fetch_run_id,
      request_id: attempts[0]?.request_id,
      error_code: sanitizeDiagnosticText(errorRecord?.code, 100),
    }))
  }
}
