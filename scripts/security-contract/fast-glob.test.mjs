/* Commento didattico:
 * Scopo: definisce il contratto ridotto dell'adapter locale usato dal plugin Next.
 * Flusso: verifica path letterali, array e rifiuto preventivo di pattern/opzioni non supportati.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { globSync } = require('./fast-glob')

describe('adapter fast-glob locale per il contratto Utraya', () => {
  let fixtureRoot
  let firstRoot
  let secondRoot
  let filePath

  beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utraya-fast-glob-'))
    firstRoot = path.join(fixtureRoot, 'packages', 'web')
    secondRoot = path.join(fixtureRoot, 'packages', 'docs')
    filePath = path.join(fixtureRoot, 'not-a-directory.ts')
    fs.mkdirSync(firstRoot, { recursive: true })
    fs.mkdirSync(secondRoot, { recursive: true })
    fs.writeFileSync(filePath, '')
  })

  afterAll(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('preserves a literal relative directory as one root', () => {
    const relativeRoot = path.relative(process.cwd(), firstRoot)

    expect(globSync(relativeRoot, { onlyDirectories: true })).toEqual([relativeRoot])
  })

  it('preserves a literal absolute directory as one root', () => {
    expect(globSync(firstRoot, { onlyDirectories: true })).toEqual([firstRoot])
  })

  it('treats backslashes as path separators', () => {
    const relativeRoot = path.relative(process.cwd(), firstRoot)
    const windowsSeparators = relativeRoot.split(path.sep).join('\\')

    expect(globSync(windowsSeparators, { onlyDirectories: true })).toEqual([relativeRoot])
  })

  it('preserves the order of an array of literal roots', () => {
    const roots = [firstRoot, secondRoot]

    expect(globSync(roots, { onlyDirectories: true })).toEqual(roots)
  })

  it('returns no roots for missing paths and files', () => {
    const missingRoot = path.join(fixtureRoot, 'missing')

    expect(globSync([missingRoot, filePath], { onlyDirectories: true })).toEqual([])
  })

  it('rejects glob syntax before returning any roots', () => {
    const patternAfterValidRoot = [firstRoot, path.join(fixtureRoot, '*')]

    expect(() => globSync(patternAfterValidRoot, { onlyDirectories: true })).toThrow(
      /glob patterns are not supported/i,
    )
  })

  it('rejects unsupported or changed options explicitly', () => {
    expect(() => globSync(firstRoot)).toThrow(/onlyDirectories: true/i)
    expect(() => globSync(firstRoot, { onlyDirectories: true, cwd: fixtureRoot })).toThrow(
      /opzione cwd/i,
    )
    expect(() => globSync(firstRoot, { onlyDirectories: false })).toThrow(/onlyDirectories: true/i)
  })

  it('rejects malformed pattern arrays explicitly', () => {
    expect(() => globSync([firstRoot, 42], { onlyDirectories: true })).toThrow(/stringa/i)
  })
})
