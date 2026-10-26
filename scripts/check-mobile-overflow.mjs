/* Scopo: verifica l'assenza di overflow orizzontale sulle pagine pubbliche a viewport mobile. */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const routes = [
  '/',
  '/login',
  '/legal/privacy',
  '/legal/cookie',
  '/legal/termini',
  '/legal/sub-processors',
  '/admin/login',
]

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
]

/** Controlla tutte le combinazioni di pagina e viewport indicate dal ticket. */
async function checkMobileOverflow(baseUrl) {
  const browser = await chromium.launch({ headless: true })
  const failures = []

  try {
    const page = await browser.newPage()

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)

      for (const route of routes) {
        try {
          await page.goto(new URL(route, baseUrl).toString(), {
            waitUntil: 'domcontentloaded',
            timeout: 45_000,
          })
          const size = await page.evaluate(() => new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              viewport: window.innerWidth,
              document: document.documentElement.scrollWidth,
            })))
          }))
          const overflow = size.document > size.viewport
          console.log(
            `${route} @ ${viewport.width}x${viewport.height}: documento ${size.document}px, viewport ${size.viewport}px${overflow ? ' — OVERFLOW' : ''}`
          )

          if (overflow) failures.push(`${route} @ ${viewport.width}x${viewport.height}: ${size.document}px > ${size.viewport}px`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`${route} @ ${viewport.width}x${viewport.height}: impossibile verificare (${message})`)
          failures.push(`${route} @ ${viewport.width}x${viewport.height}: verifica fallita`)
        }
      }
    }
  } finally {
    await browser.close()
  }

  if (failures.length > 0) {
    console.error(`FALLITO: ${failures.join('; ')}`)
    process.exitCode = 1
  } else {
    console.log('OK: nessun overflow orizzontale sulle pagine pubbliche')
  }
}

/** Avvia la verifica usando l'URL base passato da riga di comando. */
async function main() {
  const [baseUrl] = process.argv.slice(2)

  if (!baseUrl) {
    console.error('Uso: node scripts/check-mobile-overflow.mjs <baseUrl>')
    process.exitCode = 1
    return
  }

  try {
    new URL(baseUrl)
  } catch {
    console.error(`URL base non valido: ${baseUrl}`)
    process.exitCode = 1
    return
  }

  await checkMobileOverflow(baseUrl)
}

main().catch((error) => {
  console.error(`FALLITO: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
