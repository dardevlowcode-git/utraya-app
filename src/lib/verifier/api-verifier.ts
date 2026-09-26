/* Commento didattico:
 * Scopo del file: orchestrazione del verificatore API-first senza Bearer secret statici in GitHub Actions.
 * Moduli richiamati: `@/lib/supabase/admin`, `@supabase/supabase-js`.
 * Flusso: genera OTP fixture server-side, collauda `/api/v1` in memoria e compone il report sanitizzato.
 */

import { randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

export const verifierTargetOrigins = {
  preview: 'https://preview.utraya.com',
  production: 'https://utraya.com',
} as const

export type VerifierTarget = keyof typeof verifierTargetOrigins

export type VerifierCheck = {
  name: string
  path: string
  expectedStatus: number
  actualStatus: number | null
  ok: boolean
  envelopeValid?: boolean
  code?: string | null
  status?: string
  durationMs: number
}

// Genera un access token usa-e-getta per la fixture E2E senza esporre OTP o sessione.
// L'OTP nasce server-side (Admin) e il Bearer resta solo in memoria nel broker.
async function createFixtureAccessToken(): Promise<string> {
  const email = process.env.API_E2E_USER_EMAIL?.trim()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!email || !url || !anonKey) throw new Error('Fixture API verifier non configurata')

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const otp = data.properties?.email_otp
  if (error || !otp) throw new Error('OTP fixture non generato')

  const supabase = createSupabaseClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' })
  if (verifyError || !sessionData.session?.access_token) throw new Error('OTP fixture non verificato')
  return sessionData.session.access_token
}

// Esegue un singolo controllo API e ne valida contratto HTTP + envelope standard.
async function runCheck(baseUrl: string, token: string, checks: VerifierCheck[], name: string, path: string, options: { method?: string; body?: unknown; expectedStatus?: number; auth?: boolean } = {}) {
  const started = Date.now()
  const requestId = randomUUID()
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'X-Request-Id': requestId,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.auth === false ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    const valid = Boolean(body && typeof body.ok === 'boolean' && body.requestId === requestId && response.headers.get('X-Request-Id') === requestId && (body.ok ? 'data' in body : body.error && typeof (body.error as Record<string, unknown>).code === 'string'))
    const check: VerifierCheck = {
      name,
      path,
      expectedStatus: options.expectedStatus ?? 200,
      actualStatus: response.status,
      ok: response.status === (options.expectedStatus ?? 200) && valid,
      envelopeValid: valid,
      code: body?.error && typeof body.error === 'object' ? ((body.error as Record<string, unknown>).code as string ?? null) : null,
      durationMs: Date.now() - started,
    }
    checks.push(check)
    return { body, check }
  } catch (error) {
    const check: VerifierCheck = { name, path, expectedStatus: options.expectedStatus ?? 200, actualStatus: null, ok: false, status: error instanceof Error && error.name === 'TimeoutError' ? 'blocked_by_network' : 'provider_unavailable', durationMs: Date.now() - started }
    checks.push(check)
    return { body: null, check }
  }
}

// Attende il completamento di uno scan con polling sul job dedicato.
async function waitForJob(baseUrl: string, token: string, checks: VerifierCheck[], jobId: string, name: string): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const result = await runCheck(baseUrl, token, checks, `${name} (${attempt + 1})`, `/api/v1/jobs/${encodeURIComponent(jobId)}`)
    const status = (result.body?.data as Record<string, unknown> | undefined)?.status
    if (status === 'completed' || status === 'failed') return status === 'completed' && result.check.ok
    if (attempt < 14) await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  return false
}

// Esegue la suite read-only e, solo se richiesto, le mutazioni fixture con ripristino.
export async function runApiVerification(params: { target: VerifierTarget; mutations: boolean }) {
  const token = await createFixtureAccessToken()
  const baseUrl = verifierTargetOrigins[params.target]
  const checks: VerifierCheck[] = []
  const startedAt = new Date().toISOString()
  await runCheck(baseUrl, token, checks, 'unauthenticated contract', '/api/v1/me', { auth: false, expectedStatus: 401 })
  await runCheck(baseUrl, token, checks, 'profile bootstrap', '/api/v1/me')
  await runCheck(baseUrl, token, checks, 'channels list', '/api/v1/channels')
  await runCheck(baseUrl, token, checks, 'videos list', '/api/v1/videos?limit=1')
  await runCheck(baseUrl, token, checks, 'watchlist', '/api/v1/watchlist')
  await runCheck(baseUrl, token, checks, 'integrations status', '/api/v1/integrations')
  await runCheck(baseUrl, token, checks, 'legal acceptance status', '/api/v1/legal/acceptance')
  await runCheck(baseUrl, token, checks, 'account deletion status', '/api/v1/account')

  const videoId = process.env.API_E2E_VIDEO_ID?.trim()
  if (params.mutations && videoId) {
    const before = await runCheck(baseUrl, token, checks, 'video mutation fixture read', `/api/v1/videos/${encodeURIComponent(videoId)}`)
    const userState = (before.body?.data as Record<string, unknown> | undefined)?.userState as Record<string, unknown> | undefined
    const originalSeen = userState?.seenStatus
    const originalWatchlist = userState?.isInWatchlist
    if (before.check.ok && (originalSeen === 'seen' || originalSeen === 'unseen' || originalSeen === 'hidden') && typeof originalWatchlist === 'boolean') {
      try {
        await runCheck(baseUrl, token, checks, 'set video seen', '/api/v1/videos', { method: 'POST', body: { action: 'set_seen_status', videoId, seenStatus: 'seen' } })
        await runCheck(baseUrl, token, checks, 'add video to watchlist', '/api/v1/watchlist', { method: 'POST', body: { videoId } })
      } finally {
        await runCheck(baseUrl, token, checks, 'restore video seen', '/api/v1/videos', { method: 'POST', body: { action: 'set_seen_status', videoId, seenStatus: originalSeen } })
        await runCheck(baseUrl, token, checks, 'restore video watchlist', '/api/v1/videos', { method: 'POST', body: { action: 'set_watchlist', videoId, inWatchlist: originalWatchlist } })
      }
    }
  }

  const channelId = process.env.API_E2E_CHANNEL_ID?.trim()
  if (params.mutations && channelId) {
    const scan = await runCheck(baseUrl, token, checks, 'manual channel scan', '/api/v1/channels', { method: 'POST', body: { action: 'scan_now', channelId } })
    const jobId = (scan.body?.data as Record<string, unknown> | undefined)?.jobId
    if (typeof jobId === 'string') await waitForJob(baseUrl, token, checks, jobId, 'manual scan job status')
  }

  const channelUrl = process.env.API_E2E_CHANNEL_URL?.trim()
  if (params.mutations && channelUrl) {
    const added = await runCheck(baseUrl, token, checks, 'add fixture channel', '/api/v1/channels', { method: 'POST', body: { action: 'add', channelUrl, markExistingVideosAsSeen: true }, expectedStatus: 202 })
    const addedData = added.body?.data as Record<string, unknown> | undefined
    const addedChannelId = addedData?.channelId
    const scanData = addedData?.scan as Record<string, unknown> | undefined
    const scanCompleted = typeof scanData?.jobId === 'string'
      ? await waitForJob(baseUrl, token, checks, scanData.jobId as string, 'fixture scan job status')
      : false
    if (scanCompleted && typeof addedChannelId === 'string') {
      await runCheck(baseUrl, token, checks, 'remove fixture channel', '/api/v1/channels', { method: 'DELETE', body: { channelId: addedChannelId } })
    }
  }

  const failed = checks.filter((check) => !check.ok)
  const blocked = checks.filter((check) => check.status === 'blocked_by_network' || check.status === 'provider_unavailable')
  return {
    schemaVersion: 1,
    runId: `api-${randomUUID()}`,
    target: params.target,
    baseUrl,
    mutations: params.mutations,
    startedAt,
    completedAt: new Date().toISOString(),
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length, blocked: blocked.length, status: blocked.length ? 'blocked_by_network' : failed.length ? 'failed' : 'passed' },
    checks,
    failedCount: failed.length,
  }
}
