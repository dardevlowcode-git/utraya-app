import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ESLint } from 'eslint'

const require = createRequire(import.meta.url)
const { getRootDirs } = require('@next/eslint-plugin-next/dist/utils/get-root-dirs')
const { getUrlFromAppDirectory, getUrlFromPagesDirectories } = require('@next/eslint-plugin-next/dist/utils/url')
const ROUTE_BASELINE_PATH = new URL('./route-baseline.json', import.meta.url)

/** Confronta due elenchi ordinati senza mutarli e restituisce route aggiunte e rimosse. */
function diffRoutes(baseline, current) {
  const baselineRoutes = new Set(baseline)
  const currentRoutes = new Set(current)

  return {
    added: current.filter((route) => !baselineRoutes.has(route)),
    removed: baseline.filter((route) => !currentRoutes.has(route)),
  }
}

/** Crea l'errore leggibile per una baseline diversa dalle route attualmente scoperte. */
function formatRouteBaselineMismatch(baseline, current) {
  const { added, removed } = diffRoutes(baseline, current)
  /** Rende ogni route visibile su una riga, anche nei messaggi di errore Vitest. */
  const formatRoutes = (routes) =>
    routes.length > 0 ? routes.map((route) => `  ${route}`).join('\n') : '  (nessuna)'

  return [
    `Baseline route diversa: conteggio baseline: ${baseline.length}; scoperte: ${current.length}.`,
    'Route aggiunte:',
    formatRoutes(added),
    'Route tolte:',
    formatRoutes(removed),
    'Per aggiornare dopo aver revisionato le modifiche: UPDATE_ROUTE_BASELINE=1 npx vitest run scripts/security-contract',
  ].join('\n')
}

describe('baseline delle route Next', () => {
  it('riporta le route aggiunte e tolte senza modificare gli elenchi', () => {
    const baseline = ['^\\/kept$', '^\\/removed$']
    const current = ['^\\/added$', '^\\/kept$']

    expect(diffRoutes(baseline, current)).toEqual({
      added: ['^\\/added$'],
      removed: ['^\\/removed$'],
    })
    expect(baseline).toEqual(['^\\/kept$', '^\\/removed$'])
    expect(current).toEqual(['^\\/added$', '^\\/kept$'])
  })

  it('spiega conteggi, route modificate e comando di aggiornamento', () => {
    const message = formatRouteBaselineMismatch(
      ['^\\/removed$'],
      ['^\\/added$', '^\\/new$'],
    )

    expect(message).toContain('baseline: 1; scoperte: 2')
    expect(message).toContain('Route aggiunte:\n  ^\\/added$\n  ^\\/new$')
    expect(message).toContain('Route tolte:\n  ^\\/removed$')
    expect(message).toContain('UPDATE_ROUTE_BASELINE=1 npx vitest run scripts/security-contract')
  })
})

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

  it('mantiene il default Utraya e confronta le route regex con la baseline versionata', async () => {
    const effectiveConfig = await new ESLint().calculateConfigForFile('eslint.config.mjs')
    const settings = effectiveConfig?.settings ?? {}
    const { rootDirs, routes } = discoverNextRoutes(settings)

    expect(rootDirs).toEqual([process.cwd()])

    if (process.env.UPDATE_ROUTE_BASELINE === '1') {
      fs.writeFileSync(ROUTE_BASELINE_PATH, `${JSON.stringify(routes, null, 2)}\n`)
      expect(JSON.parse(fs.readFileSync(ROUTE_BASELINE_PATH, 'utf8'))).toEqual(routes)
      return
    }

    const baseline = JSON.parse(fs.readFileSync(ROUTE_BASELINE_PATH, 'utf8'))
    const differences = diffRoutes(baseline, routes)

    expect(differences, formatRouteBaselineMismatch(baseline, routes)).toEqual({ added: [], removed: [] })
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
