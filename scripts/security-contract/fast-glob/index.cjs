/* Commento didattico:
 * Scopo: sostituisce il solo uso Next di fast-glob con ricerca directory letterali.
 * Flusso: valida input/opzioni prima delle stat e restituisce i path esistenti che sono directory.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const GLOB_SYNTAX = /[*?\[\]{}()!]/

/** Normalizza i separatori prima di controllare il contratto dei path letterali. */
function normalizePattern(pattern) {
  return pattern.replaceAll('\\', '/')
}

/** Valida l'unica opzione effettivamente passata dal plugin Next Utraya. */
function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('fast-glob locale richiede le opzioni { onlyDirectories: true }.')
  }

  const unsupportedOptions = Object.keys(options).filter((option) => option !== 'onlyDirectories')
  if (unsupportedOptions.length > 0) {
    throw new TypeError(`fast-glob locale non supporta l’opzione ${unsupportedOptions[0]}.`)
  }

  if (options.onlyDirectories !== true) {
    throw new TypeError('fast-glob locale supporta solo { onlyDirectories: true }.')
  }
}

/** Valida tutti i pattern in ingresso prima di consultare il filesystem. */
function normalizePatterns(patterns) {
  const inputPatterns = typeof patterns === 'string' ? [patterns] : patterns
  if (!Array.isArray(inputPatterns)) {
    throw new TypeError('fast-glob locale accetta solo un path stringa o un array di stringhe.')
  }

  return inputPatterns.map((pattern) => {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new TypeError('fast-glob locale accetta solo pattern stringa non vuoti.')
    }

    const normalized = normalizePattern(pattern)
    if (GLOB_SYNTAX.test(normalized)) {
      throw new TypeError(`fast-glob locale: glob patterns are not supported (${pattern}).`)
    }

    return normalized
  })
}

/** Restituisce i path esistenti che sono directory per il subset contrattuale di Utraya. */
function globSync(patterns, options) {
  validateOptions(options)
  const normalizedPatterns = normalizePatterns(patterns)

  return normalizedPatterns.flatMap((pattern) => {
    const absolutePath = path.resolve(pattern)
    try {
      if (!fs.statSync(absolutePath).isDirectory()) return []
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []
      throw error
    }

    if (path.isAbsolute(pattern)) return [absolutePath.replaceAll(path.sep, '/')]

    const relativePath = path.relative(process.cwd(), absolutePath)
    return [relativePath ? relativePath.replaceAll(path.sep, '/') : '.']
  })
}

module.exports = { globSync }
