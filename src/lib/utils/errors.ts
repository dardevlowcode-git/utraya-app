/* Commento didattico:
 * Scopo del file: fornisce funzioni di utilita` riusabili in piu` punti del progetto.
 * Moduli richiamati: `@/lib/types/domain`
 * Flusso: Le utility vengono richiamate da moduli diversi per evitare duplicazioni e standardizzare comportamenti comuni.
 */

import type { AppErrorType } from '@/lib/types/domain'
import { randomUUID } from 'node:crypto'

/**
 * Classifies an error into an AppErrorType.
 * Used to determine retry strategy and user messaging.
 *
 * - temporary: retry automatically (network, timeout, transient)
 * - structural: block and require user intervention (invalid key, quota, permission)
 */
export function classifyError(error: unknown): AppErrorType {
  if (error instanceof AppError) return error.type

  if (error instanceof Error) {
    const msg = error.message.toLowerCase()

    // Structural errors — do NOT retry
    if (
      msg.includes('invalid') ||
      msg.includes('unauthorized') ||
      msg.includes('api key') ||
      msg.includes('quota') ||
      msg.includes('permission') ||
      msg.includes('forbidden') ||
      msg.includes('403') ||
      msg.includes('401')
    ) {
      if (msg.includes('not found') || msg.includes('404')) return 'not_found'
      if (msg.includes('unauthorized') || msg.includes('401')) return 'unauthorized'
      if (msg.includes('forbidden') || msg.includes('403')) return 'forbidden'
      return 'structural'
    }

    // Temporary errors — safe to retry
    if (
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('503') ||
      msg.includes('502') ||
      msg.includes('429') // rate limit is usually temporary
    ) {
      return 'temporary'
    }
  }

  return 'unknown'
}

/** Structured application error */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly type: AppErrorType,
    public readonly statusCode?: number,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

function toPublicErrorCode(type: AppErrorType): string {
  switch (type) {
    case 'validation':
      return 'validation_failed'
    case 'unauthorized':
      return 'unauthorized'
    case 'forbidden':
      return 'forbidden'
    case 'not_found':
      return 'not_found'
    case 'temporary':
      return 'temporary_error'
    case 'structural':
      return 'service_unavailable'
    case 'unknown':
    default:
      return 'internal_error'
  }
}

function toPublicMessage(message: string, type: AppErrorType, statusCode: number): string {
  if (statusCode >= 500 || type === 'unknown' || type === 'structural' || type === 'temporary') {
    return 'Errore interno'
  }
  return message
}

/** Creates a structured error response for BFF route handlers */
export function errorResponse(
  message: string,
  type: AppErrorType,
  statusCode = 500,
  requestId: string = randomUUID()
): Response {
  return Response.json(
    {
      data: null,
      error: toPublicMessage(message, type, statusCode),
      errorType: type,
      errorCode: toPublicErrorCode(type),
      requestId,
    },
    { status: statusCode }
  )
}

/** Calculates retry delay using exponential backoff (for temporary errors) */
export function getRetryDelayMs(attemptNumber: number, baseMs = 1000): number {
  // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
  return Math.min(baseMs * Math.pow(2, attemptNumber - 1), 30_000)
}
