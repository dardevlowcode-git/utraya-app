/* Commento didattico:
 * Scopo: verifica il confine provider dei job YouTube con limiti e chiavi persistenti.
 * Flusso: il database assegna una credenziale eleggibile; ogni richiesta usa e registra il proprietario effettivo.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClientMock, resolveApiKeyMock, credentialPolicyMock, rpcMock, usageInsertMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  resolveApiKeyMock: vi.fn(),
  credentialPolicyMock: vi.fn(),
  rpcMock: vi.fn(),
  usageInsertMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: resolveApiKeyMock }))

import { fetchYouTubeScanJson } from './youtube-channel-scan'

const lease = { jobId: 'job-1', leaseId: 'lease-1', channelId: 'channel-1' }

describe('YouTube channel scan provider requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAdminClientMock.mockReturnValue({
      rpc: rpcMock,
      from: vi.fn((table: string) => table === 'user_provider_credential_retry_limits'
        ? {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: credentialPolicyMock })),
          })),
        }
        : { insert: usageInsertMock }),
    })
    usageInsertMock.mockResolvedValue({ error: null })
    credentialPolicyMock.mockResolvedValue({ data: { key_version: 'version-1' }, error: null })
    resolveApiKeyMock.mockResolvedValue('key-for-selected-owner')
  })

  it('riusa la risposta persistita dopo un recovery senza chiamare di nuovo YouTube', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ status: 'cached', response: { items: [{ id: 'video-1' }] } }],
      error: null,
    })
    const fetcher = vi.fn()

    await expect(fetchYouTubeScanJson<{ items: Array<{ id: string }> }>({
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-1'),
      operation: 'videos.list',
      lease,
      fetcher,
    })).resolves.toEqual({ items: [{ id: 'video-1' }] })

    expect(fetcher).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('claim_channel_scan_provider_request', expect.objectContaining({
      p_job_id: lease.jobId,
      p_lease_id: lease.leaseId,
      p_channel_id: lease.channelId,
      p_request_key: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it('registra la richiesta riuscita per il proprietario della chiave effettivamente assegnata', async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: [{
          status: 'assigned',
          credential_id: 'credential-follower-2',
          user_id: 'follower-2',
          key_version: 'version-1',
          retry_limit: 0,
          attempt_number: 1,
          retry_at: null,
          response: null,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
    const insertMock = usageInsertMock.mockResolvedValue({ error: null })
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toContain('key=key-for-selected-owner')
      return new Response('{"items":[{"id":"video-2"}]}', { status: 200 })
    })

    await expect(fetchYouTubeScanJson<{ items: Array<{ id: string }> }>({
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-2'),
      operation: 'videos.list',
      lease,
      fetcher,
    })).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'provider_request_checkpoint' }),
    })

    expect(resolveApiKeyMock).toHaveBeenCalledWith('follower-2', 'youtube')
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'follower-2',
      provider: 'youtube',
      operation: 'videos.list',
      outcome: 'success',
    }))
    expect(rpcMock).toHaveBeenLastCalledWith('finish_channel_scan_provider_attempt', expect.objectContaining({
      p_job_id: lease.jobId,
      p_lease_id: lease.leaseId,
      p_credential_id: 'credential-follower-2',
      p_outcome: 'success',
      p_response: { items: [{ id: 'video-2' }] },
    }))
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain('key-for-selected-owner')
    expect(usageInsertMock.mock.calls[0][0]).not.toHaveProperty('url')
  })

  it('con retry limit zero conta la chiamata iniziale e avanza senza una seconda richiesta same-key', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-zero', user_id: 'follower-zero', key_version: 'version-1', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    const fetcher = vi.fn(async () => new Response('{}', { status: 503 }))

    await expect(fetchYouTubeScanJson({
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-zero'),
      operation: 'videos.list',
      lease,
      fetcher,
    })).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'advance_to_next_credential' }),
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(usageInsertMock).toHaveBeenCalledOnce()
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_outcome: 'retryable_error', p_retry_at: null })
  })

  it('mantiene il retry sulla prima chiave e ruota solo dopo il suo budget persistente', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-1', user_id: 'follower-1', key_version: 'version-1', retry_limit: 1, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-1', user_id: 'follower-1', key_version: 'version-1', retry_limit: 1, attempt_number: 2, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-2', user_id: 'follower-2', key_version: 'version-1', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    resolveApiKeyMock
      .mockResolvedValueOnce('first-follower-key')
      .mockResolvedValueOnce('first-follower-key')
      .mockResolvedValueOnce('second-follower-key')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"items":[]}', { status: 200 }))
    const request = {
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-3'),
      operation: 'videos.list',
      lease,
      fetcher,
    }

    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ channelScanDisposition: 'deferred' }),
    })
    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ channelScanDisposition: 'deferred' }),
    })
    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'provider_request_checkpoint' }),
    })

    const attemptedOwners = usageInsertMock.mock.calls.map(([event]) => (event as { user_id: string }).user_id)
    expect(attemptedOwners).toEqual(['follower-1', 'follower-1', 'follower-2'])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(rpcMock.mock.calls.filter(([name]) => name === 'finish_channel_scan_provider_attempt'))
      .toHaveLength(3)
  })

  it('non invia richieste quando non ci sono chiavi eleggibili e distingue tutte esaurite', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'waiting', credential_id: null, user_id: null, retry_limit: null, attempt_number: null, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: [{ status: 'exhausted', credential_id: null, user_id: null, retry_limit: null, attempt_number: null, retry_at: null, response: null }], error: null })
    const fetcher = vi.fn()
    const request = {
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-4'),
      operation: 'videos.list',
      lease,
      fetcher,
    }

    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ channelScanDisposition: 'waiting' }),
    })
    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ code: 'YOUTUBE_KEYS_EXHAUSTED' }),
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(resolveApiKeyMock).not.toHaveBeenCalled()
  })

  it('rispetta Retry-After e persiste il backoff invece di trattenere il worker', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-1', user_id: 'follower-1', key_version: 'version-1', retry_limit: 1, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    const fetcher = vi.fn(async () => new Response('{}', {
      status: 429,
      headers: { 'Retry-After': '5' },
    }))
    const startedAt = Date.now()

    await expect(fetchYouTubeScanJson({
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-5'),
      operation: 'videos.list',
      lease,
      fetcher,
    })).rejects.toMatchObject({
      context: expect.objectContaining({
        channelScanDisposition: 'deferred',
        dispositionReason: 'provider_retry_backoff',
      }),
    })

    const finishArgs = rpcMock.mock.calls[1][1] as { p_retry_at: string }
    expect(Date.parse(finishArgs.p_retry_at)).toBeGreaterThanOrEqual(startedAt + 5_000)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })

  it('conta una risposta provider 2xx non decodificabile come tentativo retryable', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-json', user_id: 'follower-json', key_version: 'version-1', retry_limit: 1, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    const fetcher = vi.fn(async () => new Response('not-json', { status: 200 }))

    await expect(fetchYouTubeScanJson({
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-json'),
      operation: 'videos.list',
      lease,
      fetcher,
    })).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'provider_retry_backoff' }),
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(usageInsertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'follower-json',
      outcome: 'success',
      http_status: 200,
    }))
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_outcome: 'retryable_error' })
  })

  it('esclude subito una credenziale rimossa e attribuisce la richiesta successiva al nuovo follower', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-removed', user_id: 'follower-removed', key_version: 'version-1', retry_limit: 3, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-next', user_id: 'follower-next', key_version: 'version-1', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    resolveApiKeyMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('next-follower-key')
    const fetcher = vi.fn(async () => new Response('{"items":[]}', { status: 200 }))
    const request = {
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-6'),
      operation: 'videos.list',
      lease,
      fetcher,
    }

    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'advance_to_next_credential' }),
    })
    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'provider_request_checkpoint' }),
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(usageInsertMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'follower-next' }))
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_outcome: 'ineligible' })
  })

  it('rispetta dieci retry aggiuntivi senza tenere aperto un singolo worker', async () => {
    for (let attemptNumber = 1; attemptNumber <= 11; attemptNumber += 1) {
      rpcMock
        .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-10', user_id: 'follower-10', key_version: 'version-1', retry_limit: 10, attempt_number: attemptNumber, retry_at: null, response: null }], error: null })
        .mockResolvedValueOnce({ data: true, error: null })
    }
    resolveApiKeyMock.mockResolvedValue('retry-limit-ten-key')
    const fetcher = vi.fn(async () => new Response('{}', { status: 503 }))
    const request = {
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-10'),
      operation: 'videos.list',
      lease,
      fetcher,
    }

    for (let attemptNumber = 1; attemptNumber <= 11; attemptNumber += 1) {
      const result = fetchYouTubeScanJson(request)
      if (attemptNumber === 11) {
        await expect(result).rejects.toMatchObject({
          context: expect.objectContaining({ dispositionReason: 'advance_to_next_credential' }),
        })
      } else {
        await expect(result).rejects.toMatchObject({
          context: expect.objectContaining({ dispositionReason: 'provider_retry_backoff' }),
        })
      }
    }

    expect(fetcher).toHaveBeenCalledTimes(11)
    expect(usageInsertMock.mock.calls).toHaveLength(11)
    expect(usageInsertMock.mock.calls.every(([event]) => (event as { user_id: string }).user_id === 'follower-10')).toBe(true)
  })

  it('esclude una versione sostituita e non le attribuisce né richiesta né budget', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-replaced', user_id: 'follower-replaced', key_version: 'old-version', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-replaced', user_id: 'follower-replaced', key_version: 'new-version', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    credentialPolicyMock.mockResolvedValue({ data: { key_version: 'new-version' }, error: null })
    resolveApiKeyMock.mockResolvedValue('replacement-secret')
    const fetcher = vi.fn(async () => new Response('{"items":[]}', { status: 200 }))
    const request = {
      url: new URL('https://www.googleapis.com/youtube/v3/videos?id=video-replaced'),
      operation: 'videos.list',
      lease,
      fetcher,
    }

    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'advance_to_next_credential' }),
    })
    await expect(fetchYouTubeScanJson(request)).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'provider_request_checkpoint' }),
    })

    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_outcome: 'ineligible', p_key_version: 'old-version' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(usageInsertMock).toHaveBeenCalledOnce()
  })
})
