import type { AppErrorType } from '@/lib/types/domain'

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFIGURATION_ERROR'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'LEGAL_ACCEPTANCE_FAILED'
  | 'ACCOUNT_DELETION_FAILED'
  | 'API_USAGE_CLEANUP_FAILED'
  | 'CRON_UNAUTHORIZED'
  | 'CRON_MISCONFIGURED'
  | 'RATE_LIMITED'
  | 'GEMINI_KEY_REQUIRED'
  | 'TRANSCRIPTION_UNAVAILABLE'
  | 'TOS_ACCEPTANCE_REQUIRED'

/** Converte gli errori di dominio nel vocabolario API stabile. */
export function mapAppErrorTypeToCode(
  type: AppErrorType,
  temporaryCode: 'INTERNAL_ERROR' | 'UPSTREAM_ERROR' = 'INTERNAL_ERROR'
): ErrorCode {
  if (type === 'unauthorized') return 'UNAUTHORIZED'
  if (type === 'forbidden') return 'FORBIDDEN'
  if (type === 'not_found') return 'NOT_FOUND'
  if (type === 'validation') return 'VALIDATION_FAILED'
  if (type === 'temporary') return temporaryCode
  return 'INTERNAL_ERROR'
}
