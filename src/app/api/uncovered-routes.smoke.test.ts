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

import { POST as postAdminScanNow } from '@/app/api/admin/channels/[channelId]/scan-now/route'
import { DELETE as deleteAdminJob, POST as postAdminJob } from '@/app/api/admin/jobs/[jobId]/route'
import { POST as postAdminLogsCleanup } from '@/app/api/admin/logs/cleanup/route'
import { POST as postV1CancelDeletion } from '@/app/api/v1/account/cancel-deletion/route'
import { DELETE as deleteIntegrations, GET as getIntegrations, POST as postIntegrations } from '@/app/api/integrations/route'
import { GET as getV1LegalAcceptance } from '@/app/api/v1/legal/acceptance/route'
import { GET as getV1Video } from '@/app/api/v1/videos/[videoId]/route'
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
  { routeFile: 'src/app/api/admin/channels/[channelId]/scan-now/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminScanNow(requestFor('POST', '/admin/channels/not-a-real-id/scan-now'), { params: Promise.resolve({ channelId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/admin/jobs/[jobId]/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminJob(requestFor('POST', '/admin/jobs/not-a-real-id'), { params: Promise.resolve({ jobId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/admin/jobs/[jobId]/route.ts', method: 'DELETE', expectedStatus: 401, run: () => deleteAdminJob(requestFor('DELETE', '/admin/jobs/not-a-real-id'), { params: Promise.resolve({ jobId: 'not-a-real-id' }) }) },
  { routeFile: 'src/app/api/admin/logs/cleanup/route.ts', method: 'POST', expectedStatus: 401, run: () => postAdminLogsCleanup(requestFor('POST', '/admin/logs/cleanup')) },
  { routeFile: 'src/app/api/v1/account/cancel-deletion/route.ts', method: 'POST', expectedStatus: 400, run: () => postV1CancelDeletion(requestFor('POST', '/v1/account/cancel-deletion')) },
  { routeFile: 'src/app/api/v1/legal/acceptance/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1LegalAcceptance(requestFor('GET', '/v1/legal/acceptance')) },
  { routeFile: 'src/app/api/v1/videos/[videoId]/route.ts', method: 'GET', expectedStatus: 401, run: () => getV1Video(requestFor('GET', '/v1/videos/not-a-real-id'), { params: Promise.resolve({ videoId: 'not-a-real-id' }) }) },
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
