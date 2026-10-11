/* Commento didattico:
 * Scopo: misura overflow e navigazione mobile nella shell con le vere route admin renderizzate.
 * Moduli richiamati: layout, pagine canoniche, Tailwind e Chromium headless opzionale.
 * Flusso: rende le route con dati isolati, carica il CSS prodotto dal progetto e verifica geometria desktop/mobile.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdminSessionMock, loadVideosMock, loadDetailMock, translateMock } = vi.hoisted(() => {
  const translations: Record<string, string> = {
    'admin.title': 'Console Admin',
    'admin.system': 'Sistema',
    'admin.users.title': 'Gestione utenti',
    'nav.channels': 'Canali',
    'admin.content.title': 'Contenuto canonico',
    'admin.aiProfile.title': 'Profilo analisi AI',
    'admin.jobs.title': 'Job e operazioni',
    'admin.logs.title': 'Log e audit',
    'admin.backToApp': "Torna all'app",
    'admin.content.subtitle': 'Rivedi i contenuti canonici già salvati.',
    'admin.content.adminEdited': 'MODIFICATO ADMIN',
    'admin.superAdmin': 'Super-Admin',
    'common.notifications': 'Notifiche',
    'common.settings': 'Impostazioni',
  }

  return {
    getAdminSessionMock: vi.fn(),
    loadVideosMock: vi.fn(),
    loadDetailMock: vi.fn(),
    translateMock: (key: string) => translations[key] ?? key,
  }
})

vi.mock('@/lib/auth/admin', () => ({ getAdminSession: getAdminSessionMock }))
vi.mock('@/lib/services/admin-canonical-content', () => ({
  loadAdminCanonicalVideos: loadVideosMock,
  loadAdminCanonicalContentDetail: loadDetailMock,
}))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'it',
  getTranslations: async () => translateMock,
}))
vi.mock('next-intl', () => ({ useTranslations: () => translateMock }))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
  usePathname: () => '/admin/videos',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, prefetch: _prefetch, ...props }: {
      href: string
      children: React.ReactNode
      prefetch?: boolean
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      React.createElement('a', { href, ...props }, children),
  }
})
vi.mock('@/components/theme/ThemeToggle', () => ({
  default: () => createElement('button', { type: 'button', 'aria-label': 'Tema' }),
}))
vi.mock('@/components/i18n/LanguageSwitcher', () => ({
  default: () => createElement('button', { type: 'button', 'aria-label': 'Lingua' }),
}))
vi.mock('@/components/layout/Footer', () => ({
  default: () => createElement('footer', { className: 'w-full py-6' }),
}))

import AdminCanonicalContentDetailPage from '@/app/(admin)/admin/videos/[videoId]/content/[kind]/[languageCode]/page'
import AdminCanonicalVideosPage from '@/app/(admin)/admin/videos/page'
import AdminLayout from '@/app/(admin)/admin/layout'
import {
  toAdminCanonicalContentDetailViewModel,
  toAdminCanonicalVideoViewModel,
} from '@/lib/view-models/admin-canonical-content'

const chromePath = process.env.ADMIN_MOBILE_CHROME_BIN ?? [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].find((candidate) => existsSync(candidate))

const longTranscript = `${'Utraya conserva il testo canonico senza modifiche. '.repeat(16)}${'x'.repeat(320)}`

interface BrowserRouteMetrics {
  viewportWidth: number
  documentWidth: number
  bodyWidth: number
  railWidth: number
  mainLeft: number
  firstNavigationFocused: boolean
  navigationTabMovesFocus: boolean
  navigation: Array<{
    width: number
    height: number
    label: string
    labelVisible: boolean
    labelFits: boolean
    tabStop: boolean
  }>
  navigationGaps: number[]
  contentLinks: Array<{ href: string | null; label: string | null; tabStop: boolean }>
  detailLinks: Array<{ href: string | null; tabStop: boolean }>
  table: { clientWidth: number; scrollWidth: number; overflowX: string } | null
  detail: { clientWidth: number; scrollWidth: number; textLength: number } | null
}

beforeEach(() => {
  getAdminSessionMock.mockResolvedValue({ username: 'local-admin-fixture' })
  loadVideosMock.mockResolvedValue({
    status: 'ok',
    data: [toAdminCanonicalVideoViewModel({
      id: 'mobile-overflow-video',
      title: 'Contenuto canonico di prova per lo scorrimento mobile',
      youtubeVideoId: 'mobile-overflow-video',
      publishedAt: '2026-10-10T12:00:00.000Z',
      channelTitle: 'Canale di verifica',
      localizedContent: [{
        languageCode: 'it',
        shortSummary: 'Riassunto breve',
        fullSummary: 'Riassunto completo',
        generalCategory: 'Categoria',
        subcategory: 'Sottocategoria',
        isAdminEdited: false,
      }],
      transcripts: [{ languageCode: 'it', transcriptText: longTranscript }],
    })],
  })
  loadDetailMock.mockResolvedValue({
    status: 'ok',
    data: toAdminCanonicalContentDetailViewModel({
      videoId: 'mobile-overflow-video',
      videoTitle: 'Contenuto canonico di prova per lo scorrimento mobile',
      languageCode: 'it',
      kind: 'transcript',
      transcriptText: longTranscript,
    }),
  })
})

/** Rende la route admin effettiva, componendo layout e pagina senza servizi esterni. */
async function renderAdminRoute(route: 'table' | 'detail'): Promise<string> {
  const page = route === 'table'
    ? await AdminCanonicalVideosPage()
    : await AdminCanonicalContentDetailPage({
        params: Promise.resolve({
          videoId: 'mobile-overflow-video',
          kind: 'transcript',
          languageCode: 'it',
        }),
      })

  return renderToStaticMarkup(await AdminLayout({ children: page }))
}

/** Gestisce una directory browser atomica di cui possiede esclusivamente la pulizia. */
async function withOwnedBrowserTempDirectory<T>(
  parent: string,
  run: (directory: string) => Promise<T>
): Promise<T> {
  const directory = mkdtempSync(path.join(parent, '.admin-mobile-browser-test-'))
  try {
    return await run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Attende entrambe le misure prima di rilanciare invariato il primo errore. */
async function settleConcurrentMeasures<T>(
  measurements: readonly [Promise<T>, Promise<T>]
): Promise<[T, T]> {
  const [first, second] = await Promise.allSettled(measurements)
  if (first.status === 'rejected') throw first.reason
  if (second.status === 'rejected') throw second.reason
  return [first.value, second.value]
}

/** Misura DOM e layout del browser sulla route server-renderizzata con il CSS Tailwind reale. */
async function measureRoute(
  markup: string,
  css: string,
  width: number,
  height: number,
  tempParent = process.cwd()
): Promise<BrowserRouteMetrics> {
  if (!chromePath) throw new Error('Impostare ADMIN_MOBILE_CHROME_BIN per eseguire il test browser.')

  return withOwnedBrowserTempDirectory(tempParent, async (tempDir) => {
    const htmlPath = path.join(tempDir, `route-${width}.html`)
    writeFileSync(htmlPath, [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<style>${css}</style></head><body>${markup}</body></html>`,
    ].join(''))

    const profileDir = path.join(tempDir, `chrome-${width}`)
    let browser: ChildProcess | undefined
    let browserClosed: Promise<void> = Promise.resolve()
    let browserLaunchError: Error | undefined
    let socket: WebSocket | undefined
    let socketIsOpen = false

    try {
      browser = spawn(chromePath, [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ], { detached: true, stdio: 'ignore' })
      browser.on('error', (error) => {
        browserLaunchError = error
      })
      browserClosed = new Promise<void>((resolve) => browser?.once('close', () => resolve()))

      const activePortPath = path.join(profileDir, 'DevToolsActivePort')
      for (let attempt = 0; attempt < 100 && !existsSync(activePortPath); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (!existsSync(activePortPath)) {
        throw browserLaunchError ?? new Error('Chromium non ha aperto il protocollo DevTools.')
      }

      const [port] = readFileSync(activePortPath, 'utf8').split('\n')
      const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
      if (!targetResponse.ok) throw new Error(`Chromium DevTools ha restituito HTTP ${targetResponse.status}.`)
      const target = await targetResponse.json() as { webSocketDebuggerUrl: string }
      socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise<void>((resolve, reject) => {
        socket?.addEventListener('open', () => {
          socketIsOpen = true
          resolve()
        }, { once: true })
        socket?.addEventListener('error', () => reject(new Error('Connessione al protocollo DevTools fallita.')), { once: true })
      })

      let commandId = 0
      const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
      const failPending = () => {
        for (const command of pending.values()) command.reject(new Error('Connessione al protocollo DevTools interrotta.'))
        pending.clear()
      }
      socket.addEventListener('error', failPending)
      socket.addEventListener('close', failPending)
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
        if (message.id === undefined) return
        const command = pending.get(message.id)
        if (!command) return
        pending.delete(message.id)
        if (message.error) command.reject(new Error(message.error.message))
        else command.resolve(message.result)
      })
      /** Invokes one Chrome DevTools Protocol command and awaits its response. */
      function send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        const id = ++commandId
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve: (value) => resolve(value as T), reject })
          socket?.send(JSON.stringify({ id, method, params }))
        })
      }

      await send('Page.enable')
      await send('Runtime.enable')
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 768,
        screenWidth: width,
        screenHeight: height,
      })
      await send('Page.navigate', { url: `file://${htmlPath}` })

      let ready = false
      for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
        const state = await send<{ result: { value: boolean } }>('Runtime.evaluate', {
          expression: 'document.readyState === "complete" && !!document.querySelector("main")',
          returnByValue: true,
        })
        ready = state.result.value === true
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (!ready) throw new Error('La route admin non è stata renderizzata in Chromium.')

      await send('Runtime.evaluate', { expression: "document.querySelector('aside nav a')?.focus()" })
      const firstNavigationFocus = await send<{ result: { value: boolean } }>('Runtime.evaluate', {
        expression: "document.querySelector('aside nav a') === document.activeElement",
        returnByValue: true,
      })
      const tabKey = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
      await send('Input.dispatchKeyEvent', { ...tabKey, type: 'keyDown' })
      await send('Input.dispatchKeyEvent', { ...tabKey, type: 'keyUp' })

      const expression = `(() => {
        const links = [...document.querySelectorAll('aside nav a, aside > div:last-child a')];
        const tableScroller = document.querySelector('main .overflow-x-auto');
        const pre = document.querySelector('main article pre');
        const contentLinks = [...document.querySelectorAll('main table a')];
        const detailLinks = [...document.querySelectorAll('main article a')];
        const measure = (element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
        };
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          railWidth: parseFloat(getComputedStyle(document.querySelector('aside')).width),
          mainLeft: document.querySelector('main').getBoundingClientRect().left,
          firstNavigationFocused: ${firstNavigationFocus.result.value},
          navigationTabMovesFocus: links[1] === document.activeElement,
          navigation: links.map((link) => ({
            ...measure(link),
            label: link.querySelector('span:last-child')?.textContent.trim() ?? '',
            labelVisible: (() => {
              const label = link.querySelector('span:last-child');
              if (!label) return false;
              const style = getComputedStyle(label);
              const rect = label.getBoundingClientRect();
              return style.visibility === 'visible' && style.display !== 'none' && style.position !== 'absolute' && rect.width > 1 && rect.height > 1;
            })(),
            labelFits: (() => {
              const label = link.querySelector('span:last-child');
              return !!label && label.scrollWidth <= label.clientWidth;
            })(),
            tabStop: link.tabIndex >= 0,
          })),
          navigationGaps: links.slice(1).map((link, index) =>
            measure(link).top - measure(links[index]).bottom
          ),
          contentLinks: contentLinks.map((link) => ({
            href: link.getAttribute('href'),
            label: link.getAttribute('aria-label'),
            tabStop: link.tabIndex >= 0,
          })),
          detailLinks: detailLinks.map((link) => ({ href: link.getAttribute('href'), tabStop: link.tabIndex >= 0 })),
          table: tableScroller ? {
            clientWidth: tableScroller.clientWidth,
            scrollWidth: tableScroller.scrollWidth,
            overflowX: getComputedStyle(tableScroller).overflowX,
          } : null,
          detail: pre ? {
            clientWidth: pre.clientWidth,
            scrollWidth: pre.scrollWidth,
            textLength: pre.textContent.length,
          } : null,
        };
      })()`
      const evaluation = await send<{ result: { value: BrowserRouteMetrics } }>(
        'Runtime.evaluate',
        { expression, returnByValue: true }
      )
      return evaluation.result.value
    } finally {
      if (socketIsOpen) socket?.close()
      if (browser?.exitCode === null && browser.signalCode === null) {
        try {
          if (browser.pid) process.kill(-browser.pid, 'SIGTERM')
          else browser.kill('SIGTERM')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
      await browserClosed
    }
  })
}

describe('Admin mobile route layout', () => {
  it.skipIf(!chromePath)('contains the real table and detail routes on mobile and preserves desktop geometry', async () => {
    const cssPath = path.resolve('src/app/globals.css')
    const css = (await postcss([tailwindcss()]).process(
      readFileSync(cssPath, 'utf8'),
      { from: cssPath },
    )).css
    const tableMarkup = await renderAdminRoute('table')
    const detailMarkup = await renderAdminRoute('detail')
    const tempParent = mkdtempSync(path.join(process.cwd(), '.admin-mobile-browser-integration-'))

    try {
      const existingDirectory = path.join(tempParent, '.admin-mobile-browser-test')
      mkdirSync(existingDirectory)
      const sentinel = path.join(existingDirectory, 'preserve.txt')
      writeFileSync(sentinel, 'pre-existing content')

      const [mobileTable, mobileDetail] = await settleConcurrentMeasures([
        measureRoute(tableMarkup, css, 390, 844, tempParent),
        measureRoute(detailMarkup, css, 390, 844, tempParent),
      ])
      const desktopTable = await measureRoute(tableMarkup, css, 1280, 800, tempParent)

      expect(mobileTable.viewportWidth).toBe(390)
      expect(mobileTable.documentWidth).toBeLessThanOrEqual(390)
      expect(mobileTable.bodyWidth).toBeLessThanOrEqual(390)
      expect(mobileTable.table?.overflowX).toBe('auto')
      expect(mobileTable.table?.scrollWidth).toBeGreaterThan(mobileTable.table?.clientWidth ?? 0)
      expect(mobileTable.navigation.length).toBeGreaterThan(1)
      expect(mobileTable.firstNavigationFocused).toBe(true)
      expect(mobileTable.navigationTabMovesFocus).toBe(true)
      expect(mobileTable.navigation.every((link) => (
        link.labelVisible && link.labelFits && link.tabStop && link.label.length > 0 && link.width >= 44 && link.height >= 44
      )), JSON.stringify(mobileTable.navigation)).toBe(true)
      expect(mobileTable.navigationGaps.length).toBe(mobileTable.navigation.length - 1)
      expect(mobileTable.navigationGaps.every((gap) => gap >= 8)).toBe(true)
      expect(mobileTable.contentLinks).toEqual([
        { href: '/admin/videos/mobile-overflow-video/content/transcript/it', label: 'Trascrizione (IT)', tabStop: true },
        { href: '/admin/videos/mobile-overflow-video/content/summary/it', label: 'Riassunti (IT)', tabStop: true },
        { href: '/admin/videos/mobile-overflow-video/content/category/it', label: 'Categorie (IT)', tabStop: true },
      ])
      expect(mobileDetail.documentWidth).toBeLessThanOrEqual(390)
      expect(mobileDetail.detail?.textLength).toBeGreaterThan(500)
      expect(mobileDetail.detail?.scrollWidth).toBeLessThanOrEqual(mobileDetail.detail?.clientWidth ?? 0)
      expect(mobileDetail.detailLinks).toEqual([{ href: '/admin/videos', tabStop: true }])
      expect(desktopTable.documentWidth).toBeLessThanOrEqual(1280)
      expect(desktopTable.railWidth).toBe(256)
      expect(desktopTable.mainLeft).toBe(256)
      expect(desktopTable.navigation.every((link) => link.labelVisible && link.tabStop)).toBe(true)
      expect(readdirSync(tempParent)).toEqual([path.basename(existingDirectory)])
      expect(readFileSync(sentinel, 'utf8')).toBe('pre-existing content')
    } finally {
      rmSync(tempParent, { recursive: true, force: true })
    }
  })
})

describe('browser test temporary directory ownership', () => {
  it('isolates parallel runs and preserves existing files on success and failure', async () => {
    const parent = mkdtempSync(path.join(process.cwd(), '.admin-mobile-temp-contract-'))

    try {
      const existingDirectory = path.join(parent, '.admin-mobile-browser-test')
      mkdirSync(existingDirectory)
      const sentinel = path.join(existingDirectory, 'preserve.txt')
      writeFileSync(sentinel, 'pre-existing content')
      const createdDirectories: string[] = []

      const run = (name: string) => withOwnedBrowserTempDirectory(parent, async (directory) => {
        createdDirectories.push(directory)
        const file = path.join(directory, `${name}.tmp`)
        writeFileSync(file, name)
        await Promise.resolve()
        expect(readFileSync(file, 'utf8')).toBe(name)
        return directory
      })
      const [first, second] = await Promise.all([run('first'), run('second')])

      expect(first).not.toBe(second)
      expect(createdDirectories).toEqual([first, second])
      expect(existsSync(first)).toBe(false)
      expect(existsSync(second)).toBe(false)
      expect(readdirSync(parent)).toEqual([path.basename(existingDirectory)])
      expect(readFileSync(sentinel, 'utf8')).toBe('pre-existing content')

      await expect(withOwnedBrowserTempDirectory(parent, async (directory) => {
        writeFileSync(path.join(directory, 'failed.tmp'), 'owned')
        throw new Error('simulated browser failure')
      })).rejects.toThrow('simulated browser failure')
      expect(readdirSync(parent)).toEqual([path.basename(existingDirectory)])
      expect(readFileSync(sentinel, 'utf8')).toBe('pre-existing content')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('concurrent browser measurements settlement', () => {
  it('waits for an active sibling before parent cleanup and propagates the early error', async () => {
    const parent = mkdtempSync(path.join(process.cwd(), '.admin-mobile-settlement-contract-'))
    let releaseSibling: () => void = () => {}
    let pendingOperation: Promise<unknown> | undefined
    let cleanupReached = false
    let siblingSawItsProfile = false

    try {
      const profile = path.join(parent, 'detail-profile')
      const profileState = path.join(profile, 'active')
      mkdirSync(profile)
      writeFileSync(profileState, 'browser profile active')

      const earlyFailure = new Error('first browser measurement failed')
      const siblingMeasurement = new Promise<string>((resolve) => {
        releaseSibling = () => resolve('detail complete')
      }).then((result) => {
        siblingSawItsProfile = existsSync(profileState) && readFileSync(profileState, 'utf8') === 'browser profile active'
        return result
      })
      const operation = (async () => {
        try {
          return await settleConcurrentMeasures([Promise.reject(earlyFailure), siblingMeasurement])
        } finally {
          rmSync(parent, { recursive: true, force: true })
          cleanupReached = true
        }
      })()
      const operationOutcome = operation.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      )
      pendingOperation = operationOutcome

      await new Promise<void>((resolve) => setImmediate(resolve))
      const parentExistsWhileSiblingRuns = existsSync(parent)
      const profileExistsWhileSiblingRuns = existsSync(profileState)
      const cleanupStartedWhileSiblingRuns = cleanupReached
      releaseSibling()

      const outcome = await operationOutcome
      expect(outcome.status).toBe('rejected')
      if (outcome.status === 'rejected') expect(outcome.reason).toBe(earlyFailure)
      expect(parentExistsWhileSiblingRuns).toBe(true)
      expect(profileExistsWhileSiblingRuns).toBe(true)
      expect(cleanupStartedWhileSiblingRuns).toBe(false)
      expect(siblingSawItsProfile).toBe(true)
      expect(cleanupReached).toBe(true)
      expect(existsSync(parent)).toBe(false)
    } finally {
      releaseSibling()
      await pendingOperation?.catch(() => undefined)
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
