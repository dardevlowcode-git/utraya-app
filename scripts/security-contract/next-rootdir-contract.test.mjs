/* Commento didattico:
 * Scopo: verifica l'adapter attraverso le API di scoperta route realmente usate dal plugin Next.
 * Flusso: confronta la root predefinita Utraya con fixture root letterali, array ed errori espliciti.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ESLint } from 'eslint'

const require = createRequire(import.meta.url)
const { getRootDirs } = require('@next/eslint-plugin-next/dist/utils/get-root-dirs')
const { getUrlFromAppDirectory, getUrlFromPagesDirectories } = require('@next/eslint-plugin-next/dist/utils/url')
const BASELINE_ROUTE_DIGEST = 'e09c1aa7ba0e7fc65964a4acc1224e4bcb9247a15d795990c1127a63b1fa47e6'

/** Converte rootDirs Next nei medesimi path app/pages controllati dalla regola upstream. */
function findNextRouteDirectories(rootDirs, relativeDirectories) {
  return rootDirs
    .flatMap((rootDir) => relativeDirectories.map((relative) => path.join(rootDir, relative)))
    .filter((directory) => fs.existsSync(directory))
}

/** Restituisce le regex di route prodotte dai helper interni del plugin Next. */
function discoverNextRoutes(settings) {
  const rootDirs = getRootDirs({ cwd: process.cwd(), settings })
  const pagesDirectories = findNextRouteDirectories(rootDirs, ['pages', path.join('src', 'pages')])
  const appDirectories = findNextRouteDirectories(rootDirs, ['app', path.join('src', 'app')])
  const routes = [
    ...getUrlFromPagesDirectories('/', pagesDirectories),
    ...getUrlFromAppDirectory('/', appDirectories),
  ]

  return { rootDirs, routes: routes.map((route) => route.source).sort() }
}

describe('contratto rootDir nelle route Next', () => {
  let fixtureRoot
  let firstRoot
  let secondRoot
  let fileRoot

  beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utraya-next-rootdir-'))
    firstRoot = path.join(fixtureRoot, 'literal-one')
    secondRoot = path.join(fixtureRoot, 'literal-two')
    fileRoot = path.join(fixtureRoot, 'root-file.ts')

    fs.mkdirSync(path.join(firstRoot, 'app'), { recursive: true })
    fs.mkdirSync(path.join(firstRoot, 'pages'), { recursive: true })
    fs.mkdirSync(path.join(secondRoot, 'src', 'app', 'team'), { recursive: true })
    fs.mkdirSync(path.join(firstRoot, 'fixture', 'app', 'internal'), { recursive: true })
    fs.writeFileSync(path.join(firstRoot, 'app', 'page.tsx'), '')
    fs.writeFileSync(path.join(firstRoot, 'pages', 'legacy.tsx'), '')
    fs.writeFileSync(path.join(secondRoot, 'src', 'app', 'team', 'page.tsx'), '')
    fs.writeFileSync(path.join(firstRoot, 'fixture', 'app', 'internal', 'page.tsx'), '')
    fs.writeFileSync(fileRoot, '')
  })

  afterAll(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('mantiene il default Utraya e verifica tutte le 98 route regex della baseline', async () => {
    const effectiveConfig = await new ESLint().calculateConfigForFile('eslint.config.mjs')
    const settings = effectiveConfig?.settings ?? {}
    const { rootDirs, routes } = discoverNextRoutes(settings)

    expect(rootDirs).toEqual([process.cwd()])
    expect(routes).toHaveLength(98)
    expect(crypto.createHash('sha256').update(JSON.stringify(routes)).digest('hex')).toBe(BASELINE_ROUTE_DIGEST)
  })

  it('scopre le stesse route per root letterali relativi e assoluti', () => {
    const relativeRoot = path.relative(process.cwd(), firstRoot)
    const relative = discoverNextRoutes({ next: { rootDir: relativeRoot } })
    const absolute = discoverNextRoutes({ next: { rootDir: firstRoot } })
    const expectedRoutes = ['^\\/$', '^\\/legacy\\/$']

    expect(relative.rootDirs).toEqual([relativeRoot])
    expect(absolute.rootDirs).toEqual([firstRoot])
    expect(relative.routes).toEqual(expectedRoutes)
    expect(absolute.routes).toEqual(expectedRoutes)
  })

  it('unisce le route di un array di root letterali', () => {
    const { rootDirs, routes } = discoverNextRoutes({ next: { rootDir: [firstRoot, secondRoot] } })

    expect(rootDirs).toEqual([firstRoot, secondRoot])
    expect(routes).toEqual(['^\\/$', '^\\/legacy\\/$', '^\\/team$'])
  })

  it('ignora root mancanti e file, ma rifiuta un glob senza risultati parziali', () => {
    const missingRoot = path.join(fixtureRoot, 'missing-root')

    expect(discoverNextRoutes({ next: { rootDir: missingRoot } }).rootDirs).toEqual([])
    expect(discoverNextRoutes({ next: { rootDir: fileRoot } }).rootDirs).toEqual([])
    expect(() =>
      discoverNextRoutes({ next: { rootDir: [firstRoot, path.join(fixtureRoot, '*')] } }),
    ).toThrow(/glob patterns are not supported/i)
  })
})
