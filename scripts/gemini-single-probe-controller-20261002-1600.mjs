// Commento didattico:
// Scopo: controller T8 con Node fetch diretto, token temporaneo in RAM e report privo di body/segreti.
// Moduli richiamati: fetch nativo, crypto e API Vercel per provisionamento mirato della variabile sensibile.
// Flusso: prepare fa un GET pubblico con bearer finto e un dry-run mocked; live è separato e richiede gate verdi.

import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROBE_PATH = '/api/internal/gemini-single-probe-20261002-1600'
export const TOKEN_ENV = 'GEMINI_SINGLE_TOKEN_20261002_1600'
export const CAPTURE_BODY_CAP_BYTES = 1_000_000

const DEV_ORIGIN = 'https://dev.utraya.com'
const API_PREFLIGHT_PATH = '/api/v1/channels'
const PROJECT_ID = 'prj_WvMmCKqDtOFsATZW2MkCg8PHd1Ht'
const TEAM_ID = 'team_16hn9N1HvHSmJhsnREmzWt7s'
const PROJECT_NAME = 'utraya-dev'
const EXPECTED_BRANCH = 'dev'
const SAFE_HEADERS = ['content-type', 'x-request-id', 'x-vercel-id']
const TOKEN_LIFETIME_SECONDS = 840
const APPROVED_VERCEL_ENV_FILE = String.raw`C:\Users\darde\.config\utraya-dev\dev.env`

function isUsableVercelToken(value) {
  return typeof value === 'string' && value.length > 0 && !/[\s\u0000#]/.test(value)
}

export function parseApprovedVercelTokenLine(line) {
  const match = /^\s*(?:export\s+)?VERCEL_TOKEN_DEV\s*=\s*(.*?)\s*$/.exec(line)
  if (!match) return { matched: false, token: null }

  let token = match[1]
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1)
  } else if (token.startsWith('"') || token.startsWith("'")) {
    return { matched: true, token: null }
  }
  return { matched: true, token: isUsableVercelToken(token) ? token : null }
}

/** @param {{environment?: Record<string, string | undefined>, filePath?: string}} [options] */
export async function loadVercelApiToken({ environment = process.env, filePath = APPROVED_VERCEL_ENV_FILE } = {}) {
  if (Object.hasOwn(environment, 'VERCEL_TOKEN_DEV')) {
    const token = environment.VERCEL_TOKEN_DEV
    return isUsableVercelToken(token) ? token : null
  }

  let stream
  let lines
  try {
    stream = createReadStream(filePath, { encoding: 'utf8' })
    lines = createInterface({ input: stream, crlfDelay: Infinity })
    let matchedCount = 0
    let token = null
    let invalid = false
    for await (const line of lines) {
      const parsed = parseApprovedVercelTokenLine(line)
      if (!parsed.matched) continue
      matchedCount += 1
      if (!parsed.token) invalid = true
      else token = parsed.token
    }
    return matchedCount === 1 && !invalid ? token : null
  } catch {
    return null
  } finally {
    lines?.close()
    stream?.destroy()
  }
}

function safeHeaders(headers) {
  const result = {}
  for (const name of SAFE_HEADERS) {
    const value = headers.get(name)
    if (value) result[name] = value.slice(0, 200)
  }
  return result
}

export async function captureResponse(response, maxBytes = CAPTURE_BODY_CAP_BYTES) {
  const capture = {
    captured: response instanceof Response,
    status: response.status,
    headers: safeHeaders(response.headers),
    bodyText: '',
    bodyBytes: 0,
    truncated: false,
    bodyReadFailed: false,
  }
  if (!response.body) return capture

  const reader = response.body.getReader()
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      const remaining = maxBytes - capture.bodyBytes
      if (remaining <= 0) {
        capture.truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
      if (value.byteLength > remaining) {
        chunks.push(Buffer.from(value.subarray(0, remaining)))
        capture.bodyBytes += remaining
        capture.truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(Buffer.from(value))
      capture.bodyBytes += value.byteLength
    }
    capture.bodyText = Buffer.concat(chunks, capture.bodyBytes).toString('utf8')
  } catch {
    capture.bodyReadFailed = true
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Il reader può essere già chiuso/cancellato.
    }
  }
  return capture
}

export async function fetchCaptured(fetchImpl, url, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController()
  let timer
  const requestPromise = (async () => {
    const response = await fetchImpl(url, {
      ...init,
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    })
    return captureResponse(response)
  })()
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('request_timeout'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([requestPromise, timeoutPromise])
  } catch {
    return {
      captured: false,
      status: null,
      headers: {},
      bodyText: '',
      bodyBytes: 0,
      truncated: false,
      bodyReadFailed: false,
      failure: 'request_failed_or_timeout',
    }
  } finally {
    clearTimeout(timer)
  }
}

function parseCapturedJson(capture) {
  if (!capture.captured || capture.truncated || capture.bodyReadFailed || !capture.bodyText) return null
  try {
    return JSON.parse(capture.bodyText)
  } catch {
    return null
  }
}

function apiEnvelopeSummary(capture) {
  const body = parseCapturedJson(capture)
  const requestId = typeof body?.requestId === 'string' ? body.requestId : null
  return {
    ok: body?.ok === false && typeof body?.error?.code === 'string' && Boolean(requestId),
    errorCodePresent: typeof body?.error?.code === 'string',
    requestIdPresent: Boolean(requestId),
    requestIdHeaderMatches: Boolean(requestId) && capture.headers['x-request-id'] === requestId,
  }
}

export async function runTransportCheck(fetchImpl = globalThis.fetch) {
  const fakeBearer = `Bearer offline-invalid-${randomBytes(18).toString('base64url')}`
  const capture = await fetchCaptured(
    fetchImpl,
    `${DEV_ORIGIN}${API_PREFLIGHT_PATH}`,
    { method: 'GET', headers: { authorization: fakeBearer, accept: 'application/json' } },
    30_000
  )
  const envelope = apiEnvelopeSummary(capture)
  return {
    ok: capture.status === 401 && envelope.ok && envelope.requestIdHeaderMatches && !capture.truncated && !capture.bodyReadFailed,
    status: capture.status,
    headers: capture.headers,
    bodyCaptured: capture.bodyBytes > 0,
    bodyBytes: capture.bodyBytes,
    bodyTruncated: capture.truncated,
    envelope,
  }
}

function delayedResponse(delayMs, status, headers, body) {
  const stream = new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      }, delayMs)
    },
  })
  return new Response(stream, { status, headers })
}

export async function runDryRun() {
  const fakeFetch = async (input) => {
    const pathname = new URL(String(input)).pathname
    if (pathname === '/slow') {
      return delayedResponse(150, 202, { 'content-type': 'application/json', 'x-request-id': 'mock-slow' }, '{"ok":true,"case":"slow"}')
    }
    if (pathname === '/large') {
      return new Response('x'.repeat(CAPTURE_BODY_CAP_BYTES + 512), {
        status: 200,
        headers: { 'content-type': 'text/plain', 'x-request-id': 'mock-large' },
      })
    }
    return new Response('{"ok":true,"case":"normal","privateBodyMarker":"must-not-print"}', {
      status: 201,
      headers: { 'content-type': 'application/json', 'x-request-id': 'mock-normal' },
    })
  }

  const evidence = []
  const capturedBodies = []
  for (const pathname of ['/normal', '/slow', '/large']) {
    const startedAt = Date.now()
    const capture = await fetchCaptured(fakeFetch, `https://offline.invalid${pathname}`, { method: 'GET' }, 5_000)
    capturedBodies.push(capture.bodyText)
    evidence.push({
      case: pathname.slice(1),
      elapsedMs: Date.now() - startedAt,
      captured: capture.captured,
      status: capture.status,
      requestId: capture.headers['x-request-id'] ?? null,
      bodyCaptured: capture.bodyBytes > 0,
      bodyBytes: capture.bodyBytes,
      truncated: capture.truncated,
      bodyReadFailed: capture.bodyReadFailed,
    })
  }

  const [normal, slow, large] = evidence
  const checks = {
    statusHeaderBodyCaptured: normal.captured && normal.status === 201 && normal.requestId === 'mock-normal' && normal.bodyCaptured && capturedBodies[0].includes('"case":"normal"'),
    slowResponseCaptured: slow.captured && slow.status === 202 && slow.requestId === 'mock-slow' && slow.elapsedMs >= 100 && capturedBodies[1].includes('"case":"slow"'),
    oneMegabyteCap: large.captured && large.status === 200 && large.bodyBytes === CAPTURE_BODY_CAP_BYTES && large.truncated,
    bodyNotIncludedInEvidence: !JSON.stringify(evidence).includes('must-not-print'),
  }
  return { ok: Object.values(checks).every(Boolean), dryRunOnly: true, checks, evidence }
}

function printSafe(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function runPrepare() {
  const transport = await runTransportCheck()
  if (!transport.ok) {
    printSafe({ ok: false, stage: 'transport_preflight', transport, dryRun: { skipped: true } })
    process.exitCode = 2
    return
  }
  const dryRun = await runDryRun()
  printSafe({ ok: dryRun.ok, transport, dryRun })
  if (!dryRun.ok) process.exitCode = 1
}

function makeVercelUrl(path) {
  const url = new URL(`https://api.vercel.com${path}`)
  url.searchParams.set('teamId', TEAM_ID)
  return url
}

async function vercelRequest(path, { method = 'GET', body, token, timeoutMs = 30_000 } = {}) {
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const capture = await fetchCaptured(globalThis.fetch, makeVercelUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, timeoutMs)
  return { capture, body: parseCapturedJson(capture) }
}

function targetIsProductionOnly(target) {
  return target === 'production' || (Array.isArray(target) && target.length === 1 && target[0] === 'production')
}

function deploymentFacts(body) {
  const meta = body?.meta ?? body?.metadata ?? {}
  return {
    id: typeof body?.id === 'string' ? body.id : null,
    projectId: typeof body?.projectId === 'string' ? body.projectId : null,
    readyState: body?.readyState ?? body?.state ?? null,
    target: body?.target ?? null,
    ref: meta.githubCommitRef ?? meta.gitCommitRef ?? meta.commitRef ?? null,
    commit: meta.githubCommitSha ?? meta.gitCommitSha ?? meta.commitSha ?? null,
  }
}

function validDevProductionDeployment(facts) {
  return facts.projectId === PROJECT_ID && facts.readyState === 'READY' && facts.target === 'production' && facts.ref === EXPECTED_BRANCH
}

function safeProviderErrorCode(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Z0-9_]+$/.test(value) ? value : null
}

function safeTimestamp(value) {
  return typeof value === 'string' && value.length <= 32 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
}

function safeUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function summarizeRunnerBody(capture) {
  const body = parseCapturedJson(capture)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const summary = {}
  if (typeof body.ok === 'boolean') summary.ok = body.ok
  if (body.mode === 'ready' || body.mode === 'readback') summary.mode = body.mode
  if (typeof body.ready === 'boolean') summary.ready = body.ready
  if (typeof body.failure === 'string' && /^[a-z0-9_]{1,64}$/.test(body.failure)) summary.failure = body.failure
  if (body.model === 'gemini-3.5-flash-lite') summary.model = body.model
  for (const field of ['languageCode', 'localizedLanguage']) {
    if (typeof body[field] === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(body[field])) summary[field] = body[field]
  }
  if (typeof body.eligibleVideoAvailable === 'boolean') summary.eligibleVideoAvailable = body.eligibleVideoAvailable
  for (const field of ['jobId', 'analysisId', 'videoId', 'localizedVideoId']) {
    if (safeUuid(body[field])) summary[field] = body[field]
  }
  for (const field of ['jobStatus', 'analysisStatus']) {
    if (['pending', 'running', 'completed', 'failed'].includes(body[field])) summary[field] = body[field]
  }
  if (Number.isInteger(body.localizedCount) && body.localizedCount >= 0 && body.localizedCount <= 5_000) summary.localizedCount = body.localizedCount
  for (const field of ['analysisCreatedAt', 'analyzedAt', 'localizedCreatedAt', 'jobCreatedAt', 'jobCompletedAt']) {
    if (safeTimestamp(body[field])) summary[field] = body[field]
  }
  if (Number.isInteger(body.durationMs) && body.durationMs >= 0 && body.durationMs <= 120_000) summary.durationMs = body.durationMs
  if (Number.isInteger(body.httpStatus) && body.httpStatus >= 100 && body.httpStatus <= 599) summary.httpStatus = body.httpStatus
  const providerErrorCode = safeProviderErrorCode(body.providerErrorCode)
  if (providerErrorCode !== null) summary.providerErrorCode = providerErrorCode
  if (body.usage && typeof body.usage === 'object') {
    summary.usage = {
      inputTokens: Number.isInteger(body.usage.inputTokens) && body.usage.inputTokens >= 0 && body.usage.inputTokens <= 1_000_000_000 ? body.usage.inputTokens : null,
      outputTokens: Number.isInteger(body.usage.outputTokens) && body.usage.outputTokens >= 0 && body.usage.outputTokens <= 1_000_000_000 ? body.usage.outputTokens : null,
      totalTokens: Number.isInteger(body.usage.totalTokens) && body.usage.totalTokens >= 0 && body.usage.totalTokens <= 1_000_000_000 ? body.usage.totalTokens : null,
    }
  }
  return summary
}

async function inspectDeployment(deploymentId, token, request = vercelRequest) {
  const path = `/v13/deployments/${encodeURIComponent(deploymentId)}`
  const { capture, body } = await request(path, { token })
  return capture.status === 200 ? deploymentFacts(body) : null
}

export function identifyTemporaryEnvironment(body) {
  const records = Array.isArray(body?.envs) ? body.envs : null
  const complete = records !== null && body?.pagination?.next === null &&
    (body?.hiddenProductionEnvCount === undefined || body.hiddenProductionEnvCount === 0)
  if (!complete) return { complete: false, envId: null, matchingCount: 0 }

  const matching = records.filter((entry) => entry?.key === TOKEN_ENV && targetIsProductionOnly(entry?.target))
  const ids = matching.map((entry) => typeof entry.id === 'string' && /^icfg_[A-Za-z0-9]+$/.test(entry.id) ? entry.id : null)
  const validIds = ids.filter(Boolean)
  if (matching.length !== 1 || validIds.length !== 1) return { complete: true, envId: null, matchingCount: matching.length }
  return { complete: true, envId: validIds[0], matchingCount: 1 }
}

async function findTemporaryEnvironmentId(vercelToken, request = vercelRequest) {
  const result = await request(`/v10/projects/${PROJECT_ID}/env?decrypt=false`, { token: vercelToken })
  const selected = identifyTemporaryEnvironment(result.body)
  return {
    status: result.capture.status,
    envId: result.capture.status === 200 ? selected.envId : null,
    complete: result.capture.status === 200 && selected.complete,
    matchingCount: selected.matchingCount,
  }
}

async function provisionToken(tokenValue, vercelToken, request = vercelRequest) {
  const create = await request(`/v10/projects/${PROJECT_ID}/env`, {
    method: 'POST',
    token: vercelToken,
    body: {
      key: TOKEN_ENV,
      value: tokenValue,
      type: 'sensitive',
      target: ['production'],
      comment: 'Temporary single Gemini DEV probe; remove after T8.',
    },
  })
  const created = create.body?.created
  const createConfirmed = create.capture.status >= 200 && create.capture.status < 300
  const createAmbiguous = create.capture.status === null || create.capture.status >= 500
  if (!createConfirmed && !createAmbiguous) {
    return { ok: false, createdMayExist: false, createConfirmed: false, status: create.capture.status, failure: 'environment_create_rejected', envId: null }
  }

  let envId = typeof created?.id === 'string' && /^icfg_[A-Za-z0-9]+$/.test(created.id) ? created.id : null
  let lookupComplete = null
  if (!envId) {
    // Fallback limitato: decrypt=false e filtro in RAM solo su nome esatto + target Production.
    const lookup = await findTemporaryEnvironmentId(vercelToken, request)
    envId = lookup.envId
    lookupComplete = lookup.complete
    if (!createConfirmed) {
      return { ok: false, createdMayExist: true, createConfirmed: false, status: create.capture.status, failure: 'environment_create_ambiguous', envId, lookupComplete }
    }
    if (!envId) {
      return { ok: false, createdMayExist: true, createConfirmed: true, status: create.capture.status, failure: 'environment_id_unavailable', envId: null, lookupComplete }
    }
  }

  if (!createConfirmed) {
    return { ok: false, createdMayExist: true, createConfirmed: false, status: create.capture.status, failure: 'environment_create_ambiguous', envId, lookupComplete }
  }

  // GET puntuale verifica solo key/type/target; non si legge né si riporta il valore.
  const verified = await request(`/v1/projects/${PROJECT_ID}/env/${encodeURIComponent(envId)}`, { token: vercelToken })
  const details = verified.body
  const createMetadataMatches = created?.id === undefined || (
    created?.key === TOKEN_ENV && created?.type === 'sensitive' && targetIsProductionOnly(created?.target)
  )
  const ok = createMetadataMatches && verified.capture.status === 200 && details?.key === TOKEN_ENV &&
    details?.type === 'sensitive' && targetIsProductionOnly(details?.target)
  return { ok, createdMayExist: true, createConfirmed: true, status: verified.capture.status, failure: ok ? null : 'environment_targeted_get_not_verified', envId }
}

async function cleanupTemporaryEnvironment(envId, vercelToken, request = vercelRequest) {
  const encodedId = encodeURIComponent(envId)
  const deletion = await request(`/v9/projects/${PROJECT_ID}/env/${encodedId}`, { method: 'DELETE', token: vercelToken })
  const verification = await request(`/v1/projects/${PROJECT_ID}/env/${encodedId}`, { token: vercelToken })
  const verifiedAbsent = verification.capture.status === 404
  return {
    state: verifiedAbsent ? 'verified_absent' : 'indeterminate',
    deleteStatus: deletion.capture.status,
    verifyStatus: verification.capture.status,
    verifiedAbsent,
  }
}

async function redeployAndWait(deploymentId, vercelToken, request = vercelRequest, sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))) {
  const redeploy = await request('/v13/deployments', {
    method: 'POST',
    token: vercelToken,
    timeoutMs: 60_000,
    body: { name: PROJECT_NAME, project: PROJECT_ID, deploymentId, target: 'production' },
  })
  const newId = typeof redeploy.body?.id === 'string' ? redeploy.body.id : null
  if (redeploy.capture.status < 200 || redeploy.capture.status >= 300 || !newId) {
    return { ok: false, failure: 'temporary_deployment_not_created', status: redeploy.capture.status, deploymentId: null, facts: null }
  }

  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    const facts = await inspectDeployment(newId, vercelToken, request)
    if (facts?.readyState === 'READY') return { ok: validDevProductionDeployment(facts), failure: validDevProductionDeployment(facts) ? null : 'temporary_deployment_target_mismatch', deploymentId: newId, facts }
    if (facts?.readyState === 'ERROR' || facts?.readyState === 'CANCELED') {
      return { ok: false, failure: 'temporary_deployment_failed', deploymentId: newId, facts }
    }
    await sleep(4_000)
  }
  return { ok: false, failure: 'temporary_deployment_wait_timeout', deploymentId: newId, facts: null }
}

async function invokeRunner(method, token, timeoutMs) {
  const capture = await fetchCaptured(globalThis.fetch, `${DEV_ORIGIN}${PROBE_PATH}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  }, timeoutMs)
  return {
    status: capture.status,
    headers: capture.headers,
    bodyCaptured: capture.bodyBytes > 0,
    bodyBytes: capture.bodyBytes,
    bodyTruncated: capture.truncated,
    payload: summarizeRunnerBody(capture),
  }
}

/**
 * @typedef {{ok: boolean, stage: string, postAttempted: boolean, failure?: string, providerProbeVerified?: boolean, cleanup?: {state: string, deleteStatus?: number | null, verifyStatus?: number | null, verifiedAbsent: boolean | null}, [key: string]: any}} LiveReport
 * @param {string} deploymentId
 * @param {boolean} gatesGreen
 * @param {Record<string, any>} [dependencies]
 * @returns {Promise<LiveReport>}
 */
export async function runLive(deploymentId, gatesGreen, dependencies = {}) {
  const request = dependencies.vercelRequest ?? vercelRequest
  const runnerRequest = dependencies.invokeRunner ?? invokeRunner
  /** @type {LiveReport} */
  const report = { ok: false, stage: 'preflight', postAttempted: false }
  let vercelToken = dependencies.vercelToken ?? null
  let environmentMayExist = false
  let environmentId = null
  let providerProbeVerified = false

  try {
    if (!gatesGreen || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) {
      report.failure = 'explicit_green_gates_and_deployment_id_required'
      return report
    }
    if (!vercelToken) vercelToken = await loadVercelApiToken()
    if (!vercelToken) {
      report.failure = 'approved_vercel_token_not_available'
      return report
    }

    const initialDeployment = await inspectDeployment(deploymentId, vercelToken, request)
    if (!initialDeployment || !validDevProductionDeployment(initialDeployment)) {
      report.failure = 'initial_deployment_not_ready_dev_production'
      return report
    }

    // Il token applicativo è generato e usato solo in RAM; non viene passato in argv né stampato.
    const expiry = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS
    const temporaryToken = `${expiry}.${randomBytes(32).toString('base64url')}`
    const env = await provisionToken(temporaryToken, vercelToken, request)
    environmentMayExist = env.createdMayExist
    environmentId = env.envId
    report.stage = 'env_provision'
    report.envName = TOKEN_ENV
    report.failure = env.failure
    report.status = env.status
    if (env.lookupComplete === false) report.cleanupEvidence = 'collection_incomplete_or_ambiguous'
    if (!env.createConfirmed || !env.envId || !env.ok) return report

    const redeployed = await redeployAndWait(deploymentId, vercelToken, request, dependencies.sleep)
    if (!redeployed.ok) {
      report.stage = 'redeploy'
      report.failure = redeployed.failure
      return report
    }

    let readiness
    try {
      readiness = await runnerRequest('GET', temporaryToken, 30_000)
    } catch {
      readiness = { status: null, payload: null }
    }
    const ready = readiness.status === 200 && readiness.payload?.ok === true &&
      readiness.payload?.mode === 'ready' && readiness.payload?.ready === true &&
      readiness.payload?.model === 'gemini-3.5-flash-lite' && readiness.payload?.eligibleVideoAvailable === true
    if (!ready) {
      report.stage = 'readiness'
      report.readiness = readiness
      report.failure = 'runner_not_ready'
      return report
    }

    report.stage = 'provider_probe'
    report.deployment = { id: redeployed.deploymentId, state: redeployed.facts?.readyState, target: redeployed.facts?.target, ref: redeployed.facts?.ref, commit: redeployed.facts?.commit }
    report.readiness = readiness
    report.postAttempted = true

    // Una sola POST applicativa; anche in timeout/risposta ambigua segue solo GET e cleanup.
    let post
    try {
      post = await runnerRequest('POST', temporaryToken, 90_000)
    } catch {
      post = { status: null, payload: null }
    }
    let readback
    try {
      readback = await runnerRequest('GET', temporaryToken, 30_000)
    } catch {
      readback = { status: null, payload: null }
    }
    const persistedOnce = post.status === 200 && post.payload?.ok === true &&
      readback.status === 200 && readback.payload?.mode === 'readback' &&
      readback.payload?.analysisStatus === 'completed' && readback.payload?.localizedCount === 1 &&
      readback.payload?.model === 'gemini-3.5-flash-lite'
    report.post = post
    report.readback = readback
    report.providerProbeVerified = persistedOnce
    providerProbeVerified = persistedOnce
    report.failure = persistedOnce ? null : 'provider_probe_or_readback_not_verified'
    return report
  } catch {
    report.failure = 'live_controller_failed'
    return report
  } finally {
    if (environmentMayExist) {
      if (environmentId) {
        try {
          report.cleanup = await cleanupTemporaryEnvironment(environmentId, vercelToken, request)
        } catch {
          report.cleanup = { state: 'indeterminate', deleteStatus: null, verifyStatus: null, verifiedAbsent: false }
        }
      } else {
        report.cleanup = { state: 'indeterminate', deleteStatus: null, verifyStatus: null, verifiedAbsent: false }
      }
    } else {
      report.cleanup = { state: 'not_created', verifiedAbsent: null }
    }
    if (providerProbeVerified && report.cleanup?.verifiedAbsent === true) report.ok = true
    if (providerProbeVerified && report.cleanup?.verifiedAbsent !== true) report.failure = 'temporary_environment_cleanup_not_verified'
  }
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirectExecution) {
  if (process.argv[2] === '--prepare') {
    await runPrepare()
  } else if (process.argv[2] === '--dry-run') {
    const result = await runDryRun()
    printSafe(result)
    if (!result.ok) process.exitCode = 1
  } else if (process.argv[2] === '--live' && process.argv[3] && process.argv[4] === '--gates-green') {
    const result = await runLive(process.argv[3], true)
    printSafe(result)
    if (!result.ok) process.exitCode = 2
  } else {
    printSafe({ ok: false, failure: 'use_explicit_prepare_dry_run_or_live_with_green_gates' })
    process.exitCode = 2
  }
}
