/* Commento didattico:
 * Scopo del file: calcola hash SHA-256 dei documenti legali normalizzando line-ending per coerenza cross-platform.
 * Moduli richiamati: `node:crypto`, `node:fs`.
 * Flusso: funzioni usate da runtime e script CLI per ottenere hash canonico confrontabile nel tempo.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export function hashLegalDocumentContent(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n')
  return `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`
}

export function hashLegalDocument(filePath: string): string {
  return hashLegalDocumentContent(readFileSync(filePath, 'utf8'))
}