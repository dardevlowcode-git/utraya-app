/* Commento didattico:
 * Scopo del file: script CLI per calcolare hash SHA-256 di un documento legale markdown.
 * Moduli richiamati: `node:path`, `node:fs`, `@/lib/legal/hashLegalDocument`.
 * Flusso: risolve path argomento, applica fallback root workspace e stampa hash canonico su stdout.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { hashLegalDocument } from '@/lib/legal/hashLegalDocument'

const input = process.argv[2]

if (!input) {
  console.error('Uso: npm run legal:hash -- <percorso-file-markdown>')
  process.exit(1)
}

const candidates = [
  path.resolve(process.cwd(), input),
  path.resolve(process.cwd(), '..', '..', input),
]

const target = candidates.find((candidate) => existsSync(candidate))
if (!target) {
  console.error(`File non trovato: ${input}`)
  process.exit(1)
}

console.log(hashLegalDocument(target))