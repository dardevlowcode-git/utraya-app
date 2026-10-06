import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import path from 'node:path'

const require = createRequire(import.meta.url)
const projectRoot = process.cwd()

if (!existsSync('/.dockerenv')) {
  console.error('Smoke legacy consentito solo dentro un container Docker temporaneo.')
  process.exit(1)
}

const secretBearingEnvFiles = ['.env', '.env.local', '.env.development', '.env.development.local']
const presentEnvFiles = secretBearingEnvFiles.filter((name) => existsSync(path.join(projectRoot, name)))
if (presentEnvFiles.length > 0) {
  console.error(`Rimuovere i file env dal contesto temporaneo prima dello smoke: ${presentEnvFiles.join(', ')}`)
  process.exit(1)
}

const publicPages = [
  ['home', '/'],
  ['funzionalita', '/funzionalita'],
  ['prezzi', '/prezzi'],
  ['faq', '/faq'],
  ['comparazioni', '/comparazioni'],
  ['roadmap', '/roadmap'],
  ['mission', '/mission'],
  ['chi-siamo', '/chi-siamo'],
  ['legal termini', '/legal/termini'],
  ['legal cookie', '/legal/cookie'],
  ['legal privacy', '/legal/privacy'],
  ['legal sub-processors', '/legal/sub-processors'],
  ['login', '/login'],
  ['admin login', '/admin/login'],
]

const publicAliases = [
  ['prodotto', '/prodotto', '/'],
  ['progetto', '/progetto', '/mission'],
  ['legale', '/legale', '/legal/termini'],
  ['termini-di-servizio', '/termini-di-servizio', '/legal/termini'],
  ['privacy-policy', '/privacy-policy', '/legal/privacy'],
  ['cookie-policy', '/cookie-policy', '/legal/cookie'],
]

const protectedPages = [
  ['dashboard', '/dashboard', '/login'],
  ['channels', '/channels', '/login'],
  ['tracker', '/tracker', '/login'],
  ['watchlist', '/watchlist', '/login'],
  ['account', '/settings/account', '/login'],
  ['video', '/video/smoke-video-id', '/login'],
  ['admin', '/admin', '/admin/login'],
]

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Impossibile assegnare una porta locale'))
        return
      }
      const { port } = address
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function childExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true)
      return
    }
    const timeout = setTimeout(() => resolve(false), timeoutMs)
    timeout.unref()
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
}

const port = await findFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const serverOutput = []
const nextBin = require.resolve('next/dist/bin/next')
const server = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: projectRoot,
  detached: true,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: '/tmp',
    TMPDIR: '/tmp',
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'smoke-placeholder',
    NEXT_PUBLIC_SITE_URL: baseUrl,
    CRON_SECRET: 'smoke-cron-placeholder',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

for (const stream of [server.stdout, server.stderr]) {
  stream?.setEncoding('utf8')
  stream?.on('data', (chunk) => {
    serverOutput.push(chunk)
    if (serverOutput.join('').length > 4_000) serverOutput.splice(0, serverOutput.length - 1)
  })
}

let passed = 0
let failed = 0

async function request(pathname, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(new URL(pathname, baseUrl), { ...init, signal: controller.signal, redirect: 'manual' })
  } finally {
    clearTimeout(timeout)
  }
}

async function check(name, pathname, verify, init) {
  try {
    const response = await request(pathname, init)
    const body = await response.text()
    const ok = verify(response, body)
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${response.status}`)
    if (ok) passed += 1
    else {
      failed += 1
      console.log(`  Location: ${response.headers.get('location') ?? '-'}`)
      console.log(`  Risposta: ${body.slice(0, 180).replace(/\s+/g, ' ')}`)
    }
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) break
    try {
      const response = await request('/login')
      await response.arrayBuffer()
      return
    } catch {
      await delay(500)
    }
  }
  throw new Error(`Next.js non pronto. Output server: ${serverOutput.join('').slice(-2_000)}`)
}

try {
  await waitForServer()

  for (const [name, pathname] of publicPages) {
    await check(`pagina ${name}`, pathname, (response, body) =>
      response.status === 200
      && response.headers.get('content-type')?.includes('text/html') === true
      && response.headers.get('x-content-type-options') === 'nosniff'
      && body.length > 100
    )
  }

  for (const [name, pathname, destination] of publicAliases) {
    await check(`alias ${name}`, pathname, (response) =>
      response.status === 307
      && new URL(response.headers.get('location') ?? '/', baseUrl).pathname === destination
    )
  }

  for (const [name, pathname, loginPath] of protectedPages) {
    await check(`gate ${name}`, pathname, (response) => {
      const location = response.headers.get('location')
      if (response.status !== 307 || !location) return false
      const target = new URL(location, baseUrl)
      return target.pathname === loginPath && target.searchParams.get('redirectTo') === pathname
    })
  }

  for (const [name, pathname] of [
    ['API v1 me', '/api/v1/me'],
    ['API v1 channels', '/api/v1/channels'],
    ['API v1 watchlist', '/api/v1/watchlist'],
  ]) {
    await check(name, pathname, (response, body) =>
      response.status === 401
      && response.headers.get('content-type')?.includes('application/json') === true
      && body.includes('UNAUTHORIZED')
    )
  }

  for (const [name, pathname] of [
    ['cron daily-sync', '/api/cron/daily-sync'],
    ['cron transcripts', '/api/cron/transcripts'],
  ]) {
    await check(name, pathname, (response, body) =>
      response.status === 401
      && response.headers.get('content-type')?.includes('application/json') === true
      && body.toLowerCase().includes('unauthorized')
    )
  }

  await check('admin API', '/api/admin/allowlist', (response, body) =>
    response.status === 401 && body.includes('Unauthorized')
  )

  await check('verificatore', '/api/internal/api-verifier', (response, body) =>
    response.status === 400 && body.includes('VALIDATION_FAILED'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }
  )
} catch (error) {
  failed += 1
  console.error(`FAIL avvio smoke: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      server.kill('SIGTERM')
    }
    if (!await childExit(server, 5_000)) {
      try {
        process.kill(-server.pid, 'SIGKILL')
      } catch {
        server.kill('SIGKILL')
      }
      await childExit(server, 1_000)
    }
  }
}

console.log(`Smoke legacy: ${passed} PASS, ${failed} FAIL.`)
if (failed > 0) process.exitCode = 1
