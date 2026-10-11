/* Commento didattico:
 * Scopo: definisce il Markdown TOS pubblico canonico e calcola hash SHA-256 con line-ending stabili.
 * Moduli richiamati: `node:crypto`, `node:fs`, `node:path`.
 * Flusso: loader e CLI condividono la trasformazione TOS prima di calcolare il codice documento accettato.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Produce la rappresentazione pubblica canonica TOS, eliminando header e sezioni esplicitamente non pubbliche. */
export function toPublicTosMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line))
  const termsStart = lines.findIndex((line) => /^##\s+1\.\s+/.test(line))
  if (titleIndex < 0 || termsStart < 0) throw new Error('Formato TOS non valido per la rappresentazione pubblica')

  let publicBody = lines.slice(termsStart)
  const summaryStart = publicBody.findIndex((line) => /^##\s+Sintesi giuridica\s+\(non parte del TOS pubblico\)/i.test(line))
  if (summaryStart >= 0) {
    const englishStart = publicBody.findIndex((line, index) => index > summaryStart && /^#\s+English version\b/i.test(line))
    const summaryDivider = publicBody.map((line) => line.trim()).lastIndexOf('---', summaryStart)
    const englishDivider = englishStart < 0 ? -1 : publicBody.findIndex((line, index) =>
      index > summaryStart && index < englishStart && line.trim() === '---')
    const sectionStart = summaryDivider >= 0 ? summaryDivider : summaryStart
    const sectionEnd = englishDivider >= 0 ? englishDivider : englishStart >= 0 ? englishStart : publicBody.length
    publicBody = [...publicBody.slice(0, sectionStart), ...publicBody.slice(sectionEnd)]
  }

  return [lines[titleIndex], '', ...publicBody].join('\n')
}

export function hashLegalDocumentContent(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n')
  return `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`
}

export function hashLegalDocument(filePath: string): string {
  const markdown = readFileSync(filePath, 'utf8')
  const canonical = path.basename(filePath) === 'legal-tos.md'
    ? toPublicTosMarkdown(markdown)
    : markdown
  return hashLegalDocumentContent(canonical)
}
