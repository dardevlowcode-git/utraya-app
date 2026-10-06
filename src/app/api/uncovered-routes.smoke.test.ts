/* Commento didattico:
 * Scopo: smoke-test dei metodi API senza test dedicato, verificando le guardie HTTP pubbliche.
 * Moduli richiamati: route handlers, auth mockata, filesystem e vitest.
 * Flusso: invoca ogni metodo con sessione assente o input minimo e controlla risposta JSON/status.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getAdminSessionMock, getApiUserMock, getCurrentSessionMock, getCurrentUserMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  getApiUserMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
}))

vi.mock('@/lib/auth/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/admin')>()
  return { ...actual, getAdminSession: getAdminSessionMock }
})

vi.mock('@/lib/auth/apiUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/apiUser')>()
  return { ...actual, getApiUser: getApiUserMock }
})

vi.mock('@/lib/auth/getCurrentUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/getCurrentUser')>()
  return { ...actual, getCurrentUser: getCurrentUserMock }
})

vi.mock('@/lib/auth/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/provider')>()
  return { ...actual, getCurrentSession: getCurrentSessionMock }
})

import { POST as postPublicCancelDeletion } from '@/app/api/account/cancel-deletion/route'
import { DELETE as deletePublicAccount } from '@/app/api/account/route'
import { DELETE as deleteAdminAllowlist, POST as postAdminAllowlist } from '@/app/api/admin/allowlist/route'
import { POST as postAdminLogin } from '@/app/api/admin/auth/login/route'
import { POST as postAdminLogout } from '@/app/api/admin/auth/logout/route'
import { POST as postAdminScanNow } from '@/app/api/admin/channels/[channelId]/scan-now/route'
import { DELETE as deleteAdminJob, POST as postAdminJob } from '@/app/api/admin/jobs/[jobId]/route'
import { POST as postAdminLogsCleanup } from '@/app/api/admin/logs/cleanup/route'
import { POST as postAdminTranscriptRunNow } from '@/app/api/admin/transcripts/run-now/route'
import { GET as getAdminTranscriptSettings, PUT as putAdminTranscriptSettings } from '@/app/api/admin/transcripts/settings/route'
import { DELETE as deleteAdminUser } from '@/app/api/admin/users/[userId]/route'
import { GET as getDailyDeletionExecutor } from '@/app/api/cron/daily-deletion-executor/route'
import { DELETE as deleteIntegrations, GET as getIntegrations, POST as postIntegrations } from '@/app/api/integrations/route'
import { POST as postLegalAcceptance } from '@/app/api/legal/accept/route'
import { POST as postV1CancelDeletion } from '@/app/api/v1/account/cancel-deletion/route'
import { DELETE as deleteV1Account, GET as getV1Account } from '@/app/api/v1/account/route'
import { DELETE as deleteV1Integrations, GET as getV1Integrations, POST as postV1Integrations } from '@/app/api/v1/integrations/route'
import { POST as postV1LegalAcceptance } from '@/app/api/v1/legal/accept/route'
import { GET as getV1LegalAcceptance } from '@/app/api/v1/legal/acceptance/route'
import { GET as getV1Me } from '@/app/api/v1/me/route'
import { GET as getV1Video } from '@/app/api/v1/videos/[videoId]/route'
import { DELETE as deleteV1Watchlist, GET as getV1Watchlist, POST as postV1Watchlist } from '@/app/api/v1/watchlist/route'
import { GET as getVideos, POST as postVideos } from '@/app/api/videos/route'

const routeBase = '/api'

function jsonRequest(route: string, method: string, body: unknown = {}) {
  return new Request(`http://localhost${routeBase}${route}`, {
    method,
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  })
}

function requestFor(method: string, route: string) {
  return jsonRequest(route, method)
}

type SmokeCase = {
  routeFile: string
  method: string
  expectedStatus: number
  run: () => Promise<Response> | Response
}

const smokeCases: SmokeCase[] = [
  { routeFile: 'src/app/api/account/cancel-deletion/route.ts', method: 'POST', expectedStatus: 400, run: () => postPublicCancelDeletion(requestFor('POST', '/account/cancel-deletion')) },
  { routeFile: 'src/app/api/account/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deletePublicAccount(requestFor('DELETE', '/account')) },
  { routeFile: 'src/app/api/admin/allowlist/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminAllowlist(requestFor('POST', '/admin/allowlist')) },
  { routeFile: 'src/app/api/admin/allowlist/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteAdminAllowlist(requestFor('DELETE', '/admin/allowlist')) },
  { routeFile: 'src/app/api/admin/auth/login/route.ts', method: 'POST', expectedStatus: 400, run: () => postAdminLogin(requestFor('POST', '/admin/auth/login')) },
  { routeFile: 'src/app/api/admin/auth/logout/route.ts', method: 'POST', expectedStatus: 200, run: () => postAdminLogout(requestFor('POST', '/admin/auth/logout')) },
  { routeFile: 'src/app/api/admin/channels/[channelId]/scan-now/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminScanNow(requestFor('POST', '/admin/channels/not-a-real-id/scan-now'), { params: Promise.resolve({ channelId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/admin/jobs/[jobId]/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminJob(requestFor('POST', '/admin/jobs/not-a-real-id'), { params: Promise.resolve({ jobId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/admin/jobs/[jobId]/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteAdminJob(requestFor('DELETE', '/admin/jobs/not-a-real-id'), { params: Promise.resolve({ jobId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/admin/logs/cleanup/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminLogsCleanup(requestFor('POST', '/admin/logs/cleanup')) },
  { routeFile: 'src/app/api/admin/transcripts/run-now/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminTranscriptRunNow(requestFor('POST', '/admin/transcripts/run-now')) },
  { routeFile: 'src/app/api/admin/transcripts/settings/route.ts', method: 'GET', expectedStatus: 401, run: () => getAdminTranscriptSettings(requestFor('GET', '/admin/transcripts/settings')) },
  { routeFile: 'src/app/api/admin/transcripts/settings/route.ts', method: 'PUT', expectedStatus: 401, run: () => putAdminTranscriptSettings(requestFor('PUT', '/admin/transcripts/settings')) },
  { routeFile: 'src/app/api/admin/users/[userId]/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteAdminUser(requestFor('DELETE', '/admin/users/not-a-real-id'), { params: Promise.resolve({ userId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/cron/daily-deletion-executor/route.ts', method: 'GET', expectedStatus: 401, run: () => getDailyDeletionExecutor(requestFor('GET', '/cron/daily-deletion-executor')) },
  { routeFile: 'src/app/api/integrations/route.ts', method: 'GET', expectedStatus: 401, run: () => getIntegrations() },
  { routeFile: 'src/app/api/integrations/route.ts', method: 'POST', expectedStatus: 401, run: () => postIntegrations(requestFor('POST', '/integrations')) },
  { routeFile: 'src/app/api/integrations/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteIntegrations(requestFor('DELETE', '/integrations')) },
  { routeFile: 'src/app/api/legal/accept/route.ts', method: 'POST', expectedStatus: 401, run: () => postLegalAcceptance(requestFor('POST', '/legal/accept')) },
  { routeFile: 'src/app/api/v1/account/cancel-deletion/route.ts', method: 'POST', expectedStatus: 400, run: () => postV1CancelDeletion(requestFor('POST', '/v1/account/cancel-deletion')) },
  { routeFile: 'src/app/api/v1/account/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1Account(requestFor('GET', '/v1/account')) },
  { routeFile: 'src/app/api/v1/account/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteV1Account(requestFor('DELETE', '/v1/account')) },
  { routeFile: 'src/app/api/v1/integrations/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1Integrations(requestFor('GET', '/v1/integrations')) },
  { routeFile: 'src/app/api/v1/integrations/route.ts', method: 'POST', expectedStatus: 401, run: () => postV1Integrations(requestFor('POST', '/v1/integrations')) },
  { routeFile: 'src/app/api/v1/integrations/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteV1Integrations(requestFor('DELETE', '/v1/integrations')) },
  { routeFile: 'src/app/api/v1/legal/accept/route.ts', method: 'POST', expectedStatus: 401, run: () => postV1LegalAcceptance(requestFor('POST', '/v1/legal/accept')) },
  { routeFile: 'src/app/api/v1/legal/acceptance/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1LegalAcceptance(requestFor('GET', '/v1/legal/acceptance')) },
  { routeFile: 'src/app/api/v1/me/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1Me(requestFor('GET', '/v1/me')) },
  { routeFile: 'src/app/api/v1/videos/[videoId]/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1Video(requestFor('GET', '/v1/videos/not-a-real-id'), { params: Promise.resolve({ videoId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/v1/watchlist/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1Watchlist(requestFor('GET', '/v1/watchlist')) },
  { routeFile: 'src/app/api/v1/watchlist/route.ts', method: 'POST', expectedStatus: 401, run: () => postV1Watchlist(requestFor('POST', '/v1/watchlist')) },
  { routeFile: 'src/app/api/v1/watchlist/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteV1Watchlist(requestFor('DELETE', '/v1/watchlist')) },
  { routeFile: 'src/app/api/videos/route.ts', method: 'GET', expectedStatus: 401, run: () => getVideos(requestFor('GET', '/videos')) },
  { routeFile: 'src/app/api/videos/route.ts', method: 'POST', expectedStatus: 401, run: () => postVideos(requestFor('POST', '/videos')) },
]

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(entryPath)
    return entry.name === 'route.ts' ? [entryPath] : []
  })
}

function uncoveredRouteHandlers(): string[] {
  return routeFiles(path.join(process.cwd(), 'src/app'))
    .filter((routeFile) => !existsSync(routeFile.replace(/route\.ts$/, 'route.test.ts')))
    .flatMap((routeFile) => {
      const source = readFileSync(routeFile, 'utf8')
      const methods = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/g)]
        .map((match) => match[1])
      const relativePath = path.relative(process.cwd(), routeFile)
      return methods.map((method) => `${relativePath}#${method}`)
    })
    .sort()
}

describe('smoke delle rotte senza test dedicato', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getAdminSessionMock.mockResolvedValue(null)
    getApiUserMock.mockResolvedValue(null)
    getCurrentSessionMock.mockResolvedValue(null)
    getCurrentUserMock.mockResolvedValue(null)
    vi.stubEnv('CRON_SECRET', 'test-only-cron-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('elenca tutti i metodi delle route senza test adiacente', () => {
    const expected = smokeCases.map(({ routeFile, method }) => `${routeFile}#${method}`).sort()
    expect(expected).toEqual(uncoveredRouteHandlers())
  })

  it.each(smokeCases)('$method $routeFile risponde $expectedStatus senza sessione/input valido', async ({ run, expectedStatus }) => {
    const response = await run()

    expect(response.status).toBe(expectedStatus)
    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
