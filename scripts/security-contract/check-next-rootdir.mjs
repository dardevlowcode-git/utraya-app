/* Commento didattico:
 * Scopo: blocca configurazioni ESLint Next che richiedono glob non supportati dall'adapter locale.
 * Flusso: calcola la config effettiva ESLint dei file lintabili e accetta solo rootDir letterali.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ESLint } from 'eslint'

const LINTABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const IGNORED_DIRECTORIES = new Set(['.git', '.next', 'node_modules'])
const GLOB_SYNTAX = /[*?\[\]{}()!]/

/** Raccoglie i file che il comando npm lint può valutare, senza attraversare output/deps. */
export function findLintableFiles(projectRoot = process.cwd()) {
  const files = []

  /** Visita le directory del progetto e conserva i soli file con estensioni lintate. */
  function visitDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visitDirectory(fullPath)
      } else if (entry.isFile() && LINTABLE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(path.relative(projectRoot, fullPath))
      }
    }
  }

  visitDirectory(projectRoot)
  return files.sort()
}

/** Convalida un valore rootDir contro il contratto locale senza interpretarlo come glob. */
export function validateNextRootDir(rootDir, filePath) {
  if (rootDir === undefined) return

  const roots = Array.isArray(rootDir) ? rootDir : [rootDir]
  if (!Array.isArray(rootDir) && typeof rootDir !== 'string') {
    throw new TypeError(`Next settings.rootDir in ${filePath} deve essere una stringa o un array di stringhe.`)
  }

  for (const root of roots) {
    if (typeof root !== 'string' || root.length === 0) {
      throw new TypeError(`Next settings.rootDir in ${filePath} deve contenere solo stringhe non vuote.`)
    }

    const normalized = root.replaceAll('\\', '/')
    if (GLOB_SYNTAX.test(normalized)) {
      throw new TypeError(
        `Next settings.rootDir in ${filePath} usa un glob non supportato (${root}); usare path letterali.`,
      )
    }
  }
}

/** Verifica la configurazione ESLint effettiva dei file indicati, senza affidarsi ai sorgenti config. */
export async function checkEffectiveNextRootDirs(eslint, files = findLintableFiles()) {
  if (files.length === 0) throw new Error('Nessun file lintabile trovato per il controllo Next rootDir.')

  for (const filePath of files) {
    const effectiveConfig = await eslint.calculateConfigForFile(filePath)
    const nextSettings = effectiveConfig?.settings?.next
    if (nextSettings === undefined) continue
    if (!nextSettings || typeof nextSettings !== 'object' || Array.isArray(nextSettings)) {
      throw new TypeError(`Next settings in ${filePath} devono essere un oggetto.`)
    }

    validateNextRootDir(nextSettings.rootDir, filePath)
  }

  return files.length
}

/** Esegue il controllo come comando npm e restituisce un esito leggibile. */
async function runGuard() {
  const checkedFiles = await checkEffectiveNextRootDirs(new ESLint())
  console.log(`Controllo Next rootDir superato: ${checkedFiles} file lintabili; nessun glob non supportato.`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runGuard()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
