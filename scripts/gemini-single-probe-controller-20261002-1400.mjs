// Commento didattico:
// Scopo: controller one-shot DEV con cattura HTTP in memoria e token chiamante temporaneo.
// Moduli richiamati: CLI Vercel, crypto, filesystem e child_process; il bearer viene scritto solo in un config file ACL ristretto.
// Flusso: dry-run locale prima del live; controlla deploy/env, redeploya, fa GET readiness, UNA POST e un GET readback.

import { randomBytes, randomUUID } from 'node:crypto'
import { open, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROBE_PATH = '/api/internal/gemini-single-probe-20261002-1400'
export const TOKEN_ENV = 'GEMINI_SINGLE_TOKEN_20261002_1400'
export const STATUS_MARKER = '\n__UTRAYA_HTTP_STATUS__:'
export const CAPTURE_BODY_CAP_BYTES = 1_000_000

const PROJECT = 'utraya-dev'
const EXPECTED_REF = 'dev'
const SAFE_HEADERS = ['content-type', 'x-matched-path', 'x-vercel-id', 'x-request-id']
const TOKEN_LIFETIME_SECONDS = 840

function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  let bytes = 0
  let end = 0
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > maxBytes) break
    bytes += characterBytes
    end += character.length
  }
  return { text: text.slice(0, end), truncated: true }
}

export function parseCurlCapture(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output)
  const markerIndex = text.lastIndexOf(STATUS_MARKER)
  if (markerIndex < 0) {
    return { captured: false, status: null, headers: {}, bodyText: '', bodyBytes: 0, truncated: false }
  }

  const markerStatus = Number(text.slice(markerIndex + STATUS_MARKER.length).match(/^(\d{3})/)?.[1] ?? '0')
  const wire = text.slice(0, markerIndex)
  const statusLinePattern = /^HTTP\/[^\r\n]+\s+(\d{3})(?:\s[^\r\n]*)?$/gm
  const firstStatusLine = statusLinePattern.exec(wire)
  if (!firstStatusLine) {
    return { captured: false, status: markerStatus || null, headers: {}, bodyText: '', bodyBytes: 0, truncated: false }
  }

  let status = markerStatus || null
  let headers = {}
  let bodyText = ''
  let blockStart = firstStatusLine.index
  while (blockStart >= 0 && blockStart < wire.length) {
    const lineEnd = wire.indexOf('\n', blockStart)
    if (lineEnd < 0) break
    const statusLine = wire.slice(blockStart, lineEnd).replace(/\r$/, '')
    const crlfHeaderEnd = wire.indexOf('\r\n\r\n', lineEnd + 1)
    const normalizedHeaderEnd = crlfHeaderEnd >= 0 ? crlfHeaderEnd : wire.indexOf('\n\n', lineEnd + 1)
    const separatorLength = crlfHeaderEnd >= 0 ? 4 : 2
    if (normalizedHeaderEnd < 0) break

    const blockHeaders = {}
    for (const headerLine of wire.slice(lineEnd + 1, normalizedHeaderEnd).split(/\r?\n/)) {
      const colon = headerLine.indexOf(':')
      if (colon <= 0) continue
      const name = headerLine.slice(0, colon).trim().toLowerCase()
      const value = headerLine.slice(colon + 1).trim()
      blockHeaders[name] = blockHeaders[name] ? `${blockHeaders[name]}, ${value}` : value
    }
    const lineStatus = Number(statusLine.match(/^HTTP\/[^\s]+\s+(\d{3})/)?.[1] ?? '0')
    const nextBodyStart = normalizedHeaderEnd + separatorLength
    const nextBlock = wire.slice(nextBodyStart)
    if (/^HTTP\/[^\s]+\s+\d{3}/.test(nextBlock)) {
      blockStart = nextBodyStart
      continue
    }

    status = lineStatus || status
    headers = blockHeaders
    bodyText = nextBlock
    break
  }

  const capped = truncateUtf8(bodyText, CAPTURE_BODY_CAP_BYTES)
  return {
    captured: status !== null,
    status,
    headers,
    bodyText: capped.text,
    bodyBytes: Buffer.byteLength(capped.text, 'utf8'),
    truncated: capped.truncated,
  }
}

function readJsonFromCliOutput(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output)
  const firstObject = text.indexOf('{')
  const lastObject = text.lastIndexOf('}')
  if (firstObject < 0 || lastObject < firstObject) return null
  try {
    return JSON.parse(text.slice(firstObject, lastObject + 1))
  } catch {
    return null
  }
}

function runProcess(command, args, stdinText = '', timeoutMs = 120_000) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
    })
    const stdout = []
    const stderr = []
    let timedOut = false
    let done = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveResult({ code: null, timedOut: false, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveResult({ code, timedOut, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
    child.stdin.end(stdinText)
  })
}

function runVercel(args, stdinText = '', timeoutMs = 120_000) {
  return runProcess(process.platform === 'win32' ? 'vercel.cmd' : 'vercel', args, stdinText, timeoutMs)
}

function getDeploymentMetadata(output) {
  const parsed = readJsonFromCliOutput(output)
  const deployment = parsed?.deployment ?? parsed
  const metadata = deployment?.meta ?? deployment?.metadata ?? {}
  return {
    id: typeof deployment?.id === 'string' ? deployment.id : null,
    url: typeof deployment?.url === 'string' ? deployment.url : null,
    state: deployment?.readyState ?? deployment?.state ?? null,
    target: deployment?.target ?? null,
    ref: metadata?.githubCommitRef ?? metadata?.gitCommitRef ?? null,
    commit: metadata?.githubCommitSha ?? metadata?.gitCommitSha ?? null,
  }
}

function isExpectedReadyDeployment(deployment, expectedCommit) {
  return deployment.state === 'READY' &&
    deployment.target === 'production' &&
    deployment.ref === EXPECTED_REF &&
    deployment.commit === expectedCommit
}

async function getLocalCommit() {
  const result = await runProcess('git', ['rev-parse', 'HEAD'], '', 10_000)
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null
}

async function readEnvironmentInventory() {
  const result = await runVercel(['env', 'ls', '--project', PROJECT, '--format', 'json'])
  if (result.code !== 0 || result.timedOut) return null
  const parsed = readJsonFromCliOutput(result.stdout)
  if (!Array.isArray(parsed?.envs)) return null
  return parsed.envs
    .filter((item) => typeof item?.key === 'string')
    .map((item) => ({
      key: item.key,
      targets: Array.isArray(item.target) ? item.target.filter((target) => typeof target === 'string') : [],
    }))
}

function normalizeDeploymentUrl(value) {
  if (/^dpl_[a-zA-Z0-9]+$/.test(value)) return value
  try {
    const url = new URL(value.startsWith('https://') ? value : `https://${value}`)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

async function inspectDeployment(reference, waitForReady = false) {
  const args = ['inspect', reference, '--json']
  if (waitForReady) args.push('--wait', '--timeout', '600s')
  const result = await runVercel(args, '', waitForReady ? 650_000 : 120_000)
  if (result.code !== 0 || result.timedOut) return null
  return getDeploymentMetadata(result.stdout)
}

function extractRedeployedUrl(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output)
  const urls = text.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app/gi) ?? []
  return urls.at(-1) ?? null
}

async function getWindowsSid() {
  const result = await runProcess('whoami.exe', ['/user', '/fo', 'csv', '/nh'], '', 10_000)
  if (result.code !== 0) return null
  return result.stdout.toString('utf8').match(/S-1-(?:\d+-)+\d+/)?.[0] ?? null
}

async function createAuthorizationConfig(token) {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null
  const tempRoot = join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
  try {
    await stat(tempRoot)
  } catch {
    return null
  }

  const configPath = join(tempRoot, `.utraya-gemini-1400-${randomUUID()}.conf`)
  let created = false
  try {
    const handle = await open(configPath, 'wx', 0o600)
    created = true
    await handle.close()

    const sid = await getWindowsSid()
    if (!sid) throw new Error('acl_unavailable')
    const acl = await runProcess('icacls.exe', [configPath, '/inheritance:r', '/grant:r', `*${sid}:(F)`], '', 10_000)
    if (acl.code !== 0) throw new Error('acl_restriction_failed')

    await writeFile(configPath, `header = "Authorization: Bearer ${token}"\n`, { encoding: 'utf8' })
    return configPath
  } catch {
    if (created) await rm(configPath, { force: true }).catch(() => undefined)
    return null
  }
}

async function removeAuthorizationConfig(configPath) {
  try {
    await rm(configPath, { force: true })
    await stat(configPath)
    return false
  } catch {
    return true
  }
}

function makeCurlArgs(deployment, method, configPath) {
  const args = [
    'curl',
    PROBE_PATH,
    '--deployment',
    deployment,
    '--',
    '--config',
    configPath,
    '--request',
    method,
    '--silent',
    '--show-error',
    '--include',
    '--http1.1',
    '--write-out',
    `${STATUS_MARKER}%{http_code}`,
  ]
  if (method === 'POST') args.push('--header', 'Content-Type: application/json', '--data-binary', '{}')
  return args
}

export function summarizeBody(captured) {
  if (!captured.captured || !captured.bodyText || captured.truncated) return null
  try {
    const body = JSON.parse(captured.bodyText)
    const keys = [
      'ok', 'mode', 'ready', 'failure', 'model', 'languageCode', 'eligibleVideoCount', 'eligibleVideoAvailable',
      'jobId', 'jobStatus', 'analysisId', 'analysisStatus', 'analysisCreatedAt', 'analyzedAt',
      'localizedCount', 'localizedLanguage', 'localizedCreatedAt', 'jobCreatedAt', 'jobCompletedAt',
      'durationMs', 'providerErrorCode', 'httpStatus',
    ]
    const summary = {}
    for (const key of keys) {
      if (Object.hasOwn(body, key)) summary[key] = body[key]
    }
    if (body.usage && typeof body.usage === 'object') {
      summary.usage = {
        inputTokens: Number.isInteger(body.usage.inputTokens) ? body.usage.inputTokens : null,
        outputTokens: Number.isInteger(body.usage.outputTokens) ? body.usage.outputTokens : null,
        totalTokens: Number.isInteger(body.usage.totalTokens) ? body.usage.totalTokens : null,
      }
    }
    return summary
  } catch {
    return null
  }
}

async function invokeProbe(deployment, method, token) {
  const startedAt = Date.now()
  const configPath = await createAuthorizationConfig(token)
  if (!configPath) {
    return { curlInvoked: false, authConfigRemoved: true, processExitCode: null, captured: false, status: null, payload: null }
  }

  let result
  let captured
  try {
    result = await runVercel(makeCurlArgs(deployment, method, configPath), '', method === 'POST' ? 90_000 : 30_000)
    captured = parseCurlCapture(result.stdout)
  } catch {
    result = { code: null, timedOut: false }
    captured = { captured: false, status: null, headers: {}, bodyBytes: 0, truncated: false }
  }
  const authConfigRemoved = await removeAuthorizationConfig(configPath)
  const headers = {}
  for (const name of SAFE_HEADERS) {
    if (captured.headers[name]) headers[name] = captured.headers[name]
  }
  return {
    curlInvoked: true,
    authConfigRemoved,
    processExitCode: result.code,
    processTimedOut: result.timedOut,
    elapsedMs: Date.now() - startedAt,
    captured: captured.captured,
    status: captured.status,
    headers,
    bodyBytes: captured.bodyBytes,
    bodyTruncated: captured.truncated,
    payload: summarizeBody(captured),
  }
}

function printSafe(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function runLive(initialReference) {
  const initial = normalizeDeploymentUrl(initialReference)
  if (!initial) {
    printSafe({ ok: false, stage: 'preflight', failure: 'invalid_deployment_reference' })
    process.exitCode = 2
    return
  }

  const expectedCommit = await getLocalCommit()
  const initialDeployment = await inspectDeployment(initial)
  if (!expectedCommit || !initialDeployment || !isExpectedReadyDeployment(initialDeployment, expectedCommit)) {
    printSafe({ ok: false, stage: 'preflight', failure: 'initial_deployment_not_verified_ready_dev_commit' })
    process.exitCode = 2
    return
  }

  const envInventoryBefore = await readEnvironmentInventory()
  if (!envInventoryBefore) {
    printSafe({ ok: false, stage: 'env_preflight', failure: 'environment_inventory_unavailable' })
    process.exitCode = 2
    return
  }
  if (envInventoryBefore.some((entry) => entry.key === TOKEN_ENV)) {
    printSafe({ ok: false, stage: 'env_preflight', failure: 'temporary_environment_already_exists' })
    process.exitCode = 2
    return
  }

  const expiry = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS
  const token = `${expiry}.${randomBytes(32).toString('base64url')}`
  const addResult = await runVercel(
    ['env', 'add', TOKEN_ENV, 'production', '--project', PROJECT, '--sensitive', '--yes'],
    `${token}\n`,
    60_000
  )
  const envInventoryAfter = await readEnvironmentInventory()
  const matchingEnv = envInventoryAfter?.filter((entry) => entry.key === TOKEN_ENV) ?? []
  const environmentVerified =
    matchingEnv.length === 1 &&
    matchingEnv[0].targets.length === 1 &&
    matchingEnv[0].targets[0] === 'production'
  if (addResult.code !== 0 || addResult.timedOut || !environmentVerified) {
    printSafe({
      ok: false,
      stage: 'env_provision',
      failure: addResult.timedOut ? 'environment_add_timed_out' : 'environment_add_not_verified',
      cliExitCode: addResult.code,
      environmentVerified,
    })
    process.exitCode = 2
    return
  }

  const redeployResult = await runVercel(['redeploy', initial, '--target', 'production'], '', 120_000)
  const redeployedUrl = extractRedeployedUrl(redeployResult.stdout)
  if (redeployResult.code !== 0 || redeployResult.timedOut || !redeployedUrl) {
    printSafe({ ok: false, stage: 'redeploy', failure: 'redeploy_not_verified', environmentVerified: true })
    process.exitCode = 2
    return
  }

  const readyDeployment = await inspectDeployment(redeployedUrl, true)
  if (!readyDeployment || !isExpectedReadyDeployment(readyDeployment, expectedCommit)) {
    printSafe({ ok: false, stage: 'redeploy', failure: 'redeployed_deployment_not_ready_dev_commit', environmentVerified: true })
    process.exitCode = 2
    return
  }

  const readiness = await invokeProbe(redeployedUrl, 'GET', token)
  if (!readiness.authConfigRemoved || readiness.status !== 200 || readiness.payload?.mode !== 'ready' || readiness.payload?.ready !== true) {
    printSafe({
      ok: false,
      stage: 'readiness',
      environmentName: TOKEN_ENV,
      initialDeployment: { state: initialDeployment.state, target: initialDeployment.target, ref: initialDeployment.ref, commit: initialDeployment.commit },
      probeDeployment: { state: readyDeployment.state, target: readyDeployment.target, ref: readyDeployment.ref, commit: readyDeployment.commit },
      readiness,
      postAttempted: false,
    })
    process.exitCode = 2
    return
  }

  // Questa è l'unica POST del controller: in nessun caso viene ritentata.
  const post = await invokeProbe(redeployedUrl, 'POST', token)
  const readback = await invokeProbe(redeployedUrl, 'GET', token)
  printSafe({
    ok: post.status === 200 && post.payload?.ok === true && post.authConfigRemoved,
    environmentName: TOKEN_ENV,
    initialDeployment: { state: initialDeployment.state, target: initialDeployment.target, ref: initialDeployment.ref, commit: initialDeployment.commit },
    probeDeployment: { id: readyDeployment.id, state: readyDeployment.state, target: readyDeployment.target, ref: readyDeployment.ref, commit: readyDeployment.commit },
    readiness,
    postAttempted: post.curlInvoked,
    post,
    readback,
  })
  if (post.status !== 200 || post.payload?.ok !== true || !post.authConfigRemoved) process.exitCode = 2
}

async function runCleanupEnv() {
  const before = await readEnvironmentInventory()
  if (!before) {
    printSafe({ ok: false, stage: 'env_cleanup', failure: 'environment_inventory_unavailable' })
    process.exitCode = 2
    return
  }
  const targets = Array.from(new Set(before.filter((entry) => entry.key === TOKEN_ENV).flatMap((entry) => entry.targets)))
  const removeResults = []
  for (const target of targets) {
    const result = await runVercel(['env', 'rm', TOKEN_ENV, target, '--project', PROJECT, '--yes'], '', 60_000)
    removeResults.push({ target, cliExitCode: result.code, timedOut: result.timedOut })
  }
  const after = await readEnvironmentInventory()
  const absent = after !== null && !after.some((entry) => entry.key === TOKEN_ENV)
  printSafe({ ok: absent, stage: 'env_cleanup', environmentName: TOKEN_ENV, removedTargets: targets, removeResults, verifiedAbsent: absent })
  if (!absent) process.exitCode = 2
}

function serializeResponse(response, body) {
  const headers = Array.from(response.headers.entries()).map(([name, value]) => `${name}: ${value}`).join('\r\n')
  return `HTTP/1.1 ${response.status} DRY-RUN\r\n${headers}\r\n\r\n${body}${STATUS_MARKER}${response.status}`
}

async function runDryRun() {
  const server = http.createServer((request, response) => {
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(202, { 'content-type': 'application/json', 'x-probe-case': 'slow' })
        response.end('{"ok":true,"slow":true}')
      }, 120)
      return
    }
    if (request.url === '/large') {
      response.writeHead(200, { 'content-type': 'text/plain', 'x-probe-case': 'large' })
      response.end('x'.repeat(CAPTURE_BODY_CAP_BYTES + 100))
      return
    }
    response.writeHead(201, { 'content-type': 'application/json', 'x-probe-case': 'normal' })
    response.end('{"ok":true,"ready":true}')
  })

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const port = server.address().port
  const evidence = []
  for (const path of ['/', '/slow', '/large']) {
    const startedAt = Date.now()
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    const body = await response.text()
    const captured = parseCurlCapture(serializeResponse(response, body))
    evidence.push({
      path,
      elapsedMs: Date.now() - startedAt,
      captured: captured.captured,
      status: captured.status,
      headerProbeCase: captured.headers['x-probe-case'] ?? null,
      bodyBytes: captured.bodyBytes,
      truncated: captured.truncated,
      bodyCapturedInMemory: captured.bodyText.length > 0,
    })
  }
  await new Promise((resolveClose) => server.close(resolveClose))

  const [normal, slow, large] = evidence
  const checks = [
    ['normal: status/header/body catturati', normal.captured && normal.status === 201 && normal.headerProbeCase === 'normal' && normal.bodyCapturedInMemory],
    ['normal: body non troncato', !normal.truncated],
    ['slow: risposta completata senza perdita', slow.captured && slow.status === 202 && slow.headerProbeCase === 'slow' && slow.elapsedMs >= 100],
    ['large: body cap e flag troncamento', large.truncated && large.bodyBytes === CAPTURE_BODY_CAP_BYTES],
    ['large: status/header conservati', large.captured && large.status === 200 && large.headerProbeCase === 'large'],
  ]
  for (const [name, passed] of checks) process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n`)
  printSafe({ dryRunOnly: true, cases: evidence })
  if (checks.some(([, passed]) => !passed)) process.exitCode = 1
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirectExecution) {
  if (process.argv[2] === '--dry-run') {
    await runDryRun()
  } else if (process.argv[2] === '--live' && process.argv[3]) {
    await runLive(process.argv[3])
  } else if (process.argv[2] === '--cleanup-env') {
    await runCleanupEnv()
  } else {
    printSafe({ ok: false, failure: 'use_explicit_dry_run_live_or_cleanup_mode' })
    process.exitCode = 2
  }
}
