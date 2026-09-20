/* Commento didattico:
 * Scopo del file: carica documenti legali markdown da sorgente canonica `.Progetto/specs` con fallback bundle interno.
 * Moduli richiamati: `node:fs/promises`, `node:fs`, `node:path`, `./hashLegalDocument`.
 * Flusso: le pagine `/legal/*` chiamano helper di questo modulo per contenuto, metadata e hash runtime.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { hashLegalDocumentContent } from './hashLegalDocument'

type LegalKind = 'tos' | 'privacy' | 'cookie' | 'dpa'

const LEGAL_FILE_BY_KIND: Record<LegalKind, string> = {
  tos: 'legal-tos.md',
  privacy: 'legal-privacy.md',
  cookie: 'legal-cookie.md',
  dpa: 'legal-dpa-info.md',
}

type LegalDocument = {
  title: string
  version: string
  effectiveDate: string
  hash: string
  markdown: string
}

function resolveLegalPath(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), '..', '..', '.Progetto', 'specs', fileName),
    path.resolve(process.cwd(), '.Progetto', 'specs', fileName),
    path.resolve(process.cwd(), 'src', 'content', 'legal', fileName),
  ]

  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(`Documento legale non trovato: ${fileName}`)
  }

  return found
}

function extractMetadata(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Documento legale'
  const version = markdown.match(/\*\*Versione documento\*\*:\s*`?([^`\n]+)`?/)?.[1]?.trim() ?? 'n/d'
  const effectiveDate = markdown.match(/\*\*Data di entrata in vigore\*\*:\s*([^\n]+)/)?.[1]?.trim() ?? 'n/d'
  return { title, version, effectiveDate }
}

function stripFirstHeading(markdown: string): string {
  return markdown.replace(/^#\s+.+\r?\n+/, '')
}

export async function loadLegalDocument(kind: LegalKind): Promise<LegalDocument> {
  const filePath = resolveLegalPath(LEGAL_FILE_BY_KIND[kind])
  const markdown = await readFile(filePath, 'utf8')
  const metadata = extractMetadata(markdown)

  return {
    ...metadata,
    hash: hashLegalDocumentContent(markdown),
    markdown: stripFirstHeading(markdown),
  }
}

export async function loadDpaPublicMarkdown(): Promise<LegalDocument> {
  const dpa = await loadLegalDocument('dpa')
  const lines = dpa.markdown.split(/\r?\n/)
  const keepSectionNumbers = new Set(['2', '3', '4', '7'])
  let include = false
  const extracted: string[] = []

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(\d+)\./)
    if (sectionMatch) {
      include = keepSectionNumbers.has(sectionMatch[1])
    }
    if (include) extracted.push(line)
  }

  return {
    title: 'Sub-processors e trasferimenti dati',
    version: dpa.version,
    effectiveDate: dpa.effectiveDate,
    hash: dpa.hash,
    markdown: extracted.join('\n').trim(),
  }
}