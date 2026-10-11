/* Commento didattico:
 * Scopo: verifica il gate globale e il confine provider del recupero Firecrawl.
 * Flusso: il worker consulta stato, target e RPC tramite un client admin simulato; il provider e` sempre locale.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminClientMock, rpcMock, fetchUsageMock, resolveApiKeyMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  rpcMock: vi.fn(),
  fetchUsageMock: vi.fn(),
  resolveApiKeyMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }))
vi.mock('@/lib/services/integrations', () => ({ getProviderApiKeyForUserAsAdmin: resolveApiKeyMock }))
vi.mock('@/lib/services/api-usage', () => ({ fetchAndRecordProviderRequest: fetchUsageMock }))

import { processNextFirecrawlTranscriptRecovery } from './firecrawl-transcript-recovery'

const lease = { jobId: 'job-1', leaseId: 'lease-1', channelId: 'channel-1' }

function query(value: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => value),
    update: vi.fn(() => builder),
    then: (resolve: (result: unknown) => void) => Promise.resolve(value).then(resolve),
  }
  return builder
}

function createAdmin(params: { enabled?: boolean | null; target?: unknown; keyVersion?: string; existingTranscript?: unknown }) {
  const gateQuery = query({ data: params.enabled === null ? null : { enabled: params.enabled ?? true }, error: null })
  const targetsQuery = query({ data: params.target ?? null, error: null })
  const credentialQuery = query({ data: params.keyVersion ? { key_version: params.keyVersion } : null, error: null })
  const transcriptQuery = query({ data: params.existingTranscript ?? null, error: null })
  const from = vi.fn((table: string) => {
    if (table === 'firecrawl_transcript_recovery_settings') return gateQuery
    if (table === 'channel_scan_firecrawl_transcript_targets') return targetsQuery
    if (table === 'user_provider_credential_retry_limits') return credentialQuery
    return transcriptQuery
  })
  return { admin: { from, rpc: rpcMock }, from }
}

describe('Firecrawl new-video transcript recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resolveApiKeyMock.mockResolvedValue('firecrawl-key-for-selected-owner')
    fetchUsageMock.mockImplementation(async (input: { fetcher?: typeof fetch; url: string; init?: RequestInit }) =>
      (input.fetcher ?? fetch)(input.url, input.init))
  })

  it('non invoca il provider quando il gate globale e` spento e disattiva target residui', async () => {
    const gateQuery = query({ data: { enabled: false }, error: null })
    const from = vi.fn(() => gateQuery)
    const admin = { from, rpc: rpcMock }
    createAdminClientMock.mockReturnValue(admin)
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({
      lease,
      admin: admin as never,
      fetcher,
    })).resolves.toEqual({ status: 'disabled' })

    expect(from).toHaveBeenCalledWith('firecrawl_transcript_recovery_settings')
    expect(from).toHaveBeenCalledWith('channel_scan_firecrawl_transcript_targets')
    expect(rpcMock).not.toHaveBeenCalled()
    expect(fetchUsageMock).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('non esegue recovery senza un target Firecrawl pendente', async () => {
    const gateQuery = query({ data: { enabled: true }, error: null })
    const targetsQuery = query({ data: null, error: null })
    const from = vi.fn((table: string) => table === 'firecrawl_transcript_recovery_settings'
      ? gateQuery
      : targetsQuery)
    const admin = { from, rpc: rpcMock }
    createAdminClientMock.mockReturnValue(admin)
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({
      lease,
      admin: admin as never,
      fetcher,
    })).resolves.toEqual({ status: 'idle' })

    expect(from).toHaveBeenCalledWith('channel_scan_firecrawl_transcript_targets')
    expect(rpcMock).not.toHaveBeenCalled()
    expect(fetchUsageMock).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('tratta come spento il gate se la riga globale manca', async () => {
    const { admin } = createAdmin({ enabled: null, target: { channel_id: 'channel-1', video_id: 'video-missing-gate', youtube_video_id: 'youtube-missing-gate' } })
    createAdminClientMock.mockReturnValue(admin)
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .resolves.toEqual({ status: 'disabled' })

    expect(rpcMock).not.toHaveBeenCalled()
    expect(fetchUsageMock).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('riserva una singola chiamata sul provider Firecrawl e registra il proprietario assegnato', async () => {
    const { admin } = createAdmin({
      target: { channel_id: 'canonical-channel-1', video_id: 'video-1', youtube_video_id: 'youtube-1' },
      keyVersion: 'key-version-1',
    })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-1', user_id: 'follower-1', key_version: 'key-version-1', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer firecrawl-key-for-selected-owner')
      expect(JSON.parse(String(init?.body))).toEqual({
        alexandria: {
          provider: 'youtube',
          capability: 'read',
          options: { url: 'https://www.youtube.com/watch?v=youtube-1', formats: ['markdown'] },
        },
      })
      return new Response(JSON.stringify({
        success: true,
        data: {
          alexandria: [{
            provider: 'youtube',
            capability: 'read',
            data: { document: { markdown: '# Video\n\n## Transcript\n\nTranscript disponibile.' } },
          }],
        },
      }), { status: 200 })
    })

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .rejects.toMatchObject({
        context: expect.objectContaining({
          channelScanDisposition: 'deferred',
          dispositionReason: 'provider_request_checkpoint',
        }),
      })

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'claim_channel_scan_provider_request', expect.objectContaining({
      p_job_id: lease.jobId,
      p_lease_id: lease.leaseId,
      p_channel_id: 'canonical-channel-1',
      p_provider: 'firecrawl',
      p_request_key: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(resolveApiKeyMock).toHaveBeenCalledWith('follower-1', 'firecrawl')
    expect(fetchUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'follower-1',
      provider: 'firecrawl',
      operation: 'youtube.read',
      url: 'https://api.firecrawl.dev/v2/scrape',
    }))
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'finish_channel_scan_provider_attempt', expect.objectContaining({
      p_outcome: 'success',
      p_response: { transcriptText: 'Transcript disponibile.', languageCode: 'unknown' },
    }))
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain('firecrawl-key-for-selected-owner')
  })

  it('riusa il transcript persistito dopo recovery e lo salva senza una seconda richiesta', async () => {
    const target = { channel_id: 'channel-1', video_id: 'video-2', youtube_video_id: 'youtube-2' }
    const { admin } = createAdmin({ target })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock
      .mockResolvedValueOnce({ data: [{
        status: 'cached',
        credential_id: 'credential-1',
        user_id: 'follower-1',
        response: { transcriptText: 'Transcript gia` recuperato.', languageCode: 'unknown' },
      }], error: null })
      .mockResolvedValueOnce({ data: { status: 'fetched', hasPending: false }, error: null })
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .resolves.toEqual({ status: 'fetched' })

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'claim_channel_scan_provider_request', expect.objectContaining({
      p_provider: 'firecrawl',
    }))
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'complete_firecrawl_transcript_recovery_target', expect.objectContaining({
      p_video_id: target.video_id,
      p_youtube_video_id: target.youtube_video_id,
      p_status: 'fetched',
      p_language_code: 'unknown',
      p_transcript_text: 'Transcript gia` recuperato.',
    }))
    expect(fetchUsageMock).not.toHaveBeenCalled()
    expect(resolveApiKeyMock).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('consuma il retry limit e richiede il failover quando la risposta riuscita non contiene transcript', async () => {
    const target = { channel_id: 'channel-1', video_id: 'video-3', youtube_video_id: 'youtube-3' }
    const { admin } = createAdmin({ target, keyVersion: 'key-version-1' })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-1', user_id: 'follower-1', key_version: 'key-version-1', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { status: 'missing', hasPending: false }, error: null })
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { alexandria: [{ provider: 'youtube', capability: 'read', data: { document: { markdown: '# Video\n\n## Description\nNo transcript section.' } } }] },
    }), { status: 200 }))

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .rejects.toMatchObject({ context: expect.objectContaining({ dispositionReason: 'advance_to_next_credential' }) })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetchUsageMock).toHaveBeenCalledOnce()
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'finish_channel_scan_provider_attempt', expect.objectContaining({
      p_outcome: 'retryable_error',
      p_retry_at: null,
      p_response: null,
    }))
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_lease_id: lease.leaseId })
    expect(rpcMock.mock.calls[1]?.[1]).toMatchObject({ p_lease_id: lease.leaseId })
  })

  it('riusa il canonico esistente ed evita qualunque nuova richiesta Firecrawl', async () => {
    const { admin } = createAdmin({
      target: { channel_id: 'channel-1', video_id: 'video-4', youtube_video_id: 'youtube-4' },
      existingTranscript: [{ transcript_status: 'fetched', transcript_text: 'Testo canonico.' }],
    })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock.mockResolvedValueOnce({ data: { status: 'skipped', hasPending: false }, error: null })
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .resolves.toEqual({ status: 'skipped' })

    expect(rpcMock).toHaveBeenCalledOnce()
    expect(rpcMock).toHaveBeenCalledWith('complete_firecrawl_transcript_recovery_target', expect.objectContaining({
      p_video_id: 'video-4',
      p_status: 'skipped',
    }))
    expect(resolveApiKeyMock).not.toHaveBeenCalled()
    expect(fetchUsageMock).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('mantiene retry sulla stessa chiave e ruota al follower successivo solo a budget esaurito', async () => {
    const { admin } = createAdmin({
      target: { channel_id: 'channel-1', video_id: 'video-5', youtube_video_id: 'youtube-5' },
      keyVersion: 'key-version-1',
    })
    createAdminClientMock.mockReturnValue(admin)
    resolveApiKeyMock
      .mockResolvedValueOnce('first-follower-key')
      .mockResolvedValueOnce('first-follower-key')
      .mockResolvedValueOnce('second-follower-key')
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-1', user_id: 'follower-1', key_version: 'key-version-1', retry_limit: 1, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-1', user_id: 'follower-1', key_version: 'key-version-1', retry_limit: 1, attempt_number: 2, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ status: 'assigned', credential_id: 'credential-2', user_id: 'follower-2', key_version: 'key-version-1', retry_limit: 0, attempt_number: 1, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    const noTranscript = new Response(JSON.stringify({ success: true, data: { alexandria: [] } }), { status: 200 })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(noTranscript)
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: { alexandria: [{ provider: 'youtube', capability: 'read', data: { document: { markdown: '## Transcript\nRecovered on next follower.' } } }] },
      }), { status: 200 }))
    const request = { lease, admin: admin as never, fetcher }

    await expect(processNextFirecrawlTranscriptRecovery(request)).rejects.toMatchObject({
      context: expect.objectContaining({ dispositionReason: 'provider_retry_backoff' }),
    })
    await expect(processNextFirecrawlTranscriptRecovery({ ...request, lease: { ...lease, leaseId: 'lease-2' } }))
      .rejects.toMatchObject({ context: expect.objectContaining({ dispositionReason: 'advance_to_next_credential' }) })
    await expect(processNextFirecrawlTranscriptRecovery({ ...request, lease: { ...lease, leaseId: 'lease-3' } }))
      .rejects.toMatchObject({ context: expect.objectContaining({ dispositionReason: 'provider_request_checkpoint' }) })

    expect(resolveApiKeyMock.mock.calls).toEqual([
      ['follower-1', 'firecrawl'],
      ['follower-1', 'firecrawl'],
      ['follower-2', 'firecrawl'],
    ])
    expect(fetchUsageMock.mock.calls.map(([input]) => (input as { userId: string }).userId))
      .toEqual(['follower-1', 'follower-1', 'follower-2'])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('lascia in attesa il job quando non ci sono chiavi eleggibili', async () => {
    const { admin } = createAdmin({ target: { channel_id: 'channel-1', video_id: 'video-6', youtube_video_id: 'youtube-6' } })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock.mockResolvedValueOnce({ data: [{ status: 'waiting', credential_id: null, user_id: null, key_version: null, retry_limit: null, attempt_number: null, retry_at: null, response: null }], error: null })
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .rejects.toMatchObject({ context: expect.objectContaining({ channelScanDisposition: 'waiting' }) })

    expect(rpcMock).toHaveBeenCalledOnce()
    expect(resolveApiKeyMock).not.toHaveBeenCalled()
    expect(fetchUsageMock).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rispetta il gate DB anche se cambia dopo la lettura iniziale', async () => {
    const { admin, from } = createAdmin({ target: { video_id: 'video-gate', youtube_video_id: 'youtube-gate' } })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock.mockResolvedValueOnce({ data: [{ status: 'disabled', credential_id: null, user_id: null, key_version: null, retry_limit: null, attempt_number: null, retry_at: null, response: null }], error: null })
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .resolves.toEqual({ status: 'disabled' })

    expect(rpcMock).toHaveBeenCalledOnce()
    expect(resolveApiKeyMock).not.toHaveBeenCalled()
    expect(fetchUsageMock).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(from).toHaveBeenCalledWith('channel_scan_firecrawl_transcript_targets')
  })

  it('chiude con esito transcript mancante soltanto dopo esaurimento di tutte le chiavi', async () => {
    const target = { channel_id: 'channel-1', video_id: 'video-7', youtube_video_id: 'youtube-7' }
    const { admin } = createAdmin({ target })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'exhausted', credential_id: null, user_id: null, key_version: null, retry_limit: null, attempt_number: null, retry_at: null, response: null }], error: null })
      .mockResolvedValueOnce({ data: { status: 'missing', hasPending: false }, error: null })
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .rejects.toMatchObject({ context: expect.objectContaining({ code: 'FIRECRAWL_TRANSCRIPT_UNAVAILABLE' }) })

    expect(rpcMock).toHaveBeenNthCalledWith(2, 'complete_firecrawl_transcript_recovery_target', expect.objectContaining({
      p_video_id: target.video_id,
      p_status: 'missing',
      p_transcript_text: null,
    }))
    expect(fetcher).not.toHaveBeenCalled()
    expect(fetchUsageMock).not.toHaveBeenCalled()
  })

  it('continua con una nuova lease quando restano target pendenti nel medesimo job', async () => {
    const { admin } = createAdmin({ target: { channel_id: 'channel-1', video_id: 'video-8', youtube_video_id: 'youtube-8' } })
    createAdminClientMock.mockReturnValue(admin)
    rpcMock
      .mockResolvedValueOnce({ data: [{ status: 'cached', response: { transcriptText: 'Transcript cached.', languageCode: 'unknown' } }], error: null })
      .mockResolvedValueOnce({ data: { status: 'fetched', hasPending: true }, error: null })
    const fetcher = vi.fn()

    await expect(processNextFirecrawlTranscriptRecovery({ lease, admin: admin as never, fetcher }))
      .rejects.toMatchObject({ context: expect.objectContaining({ dispositionReason: 'provider_request_checkpoint' }) })

    expect(rpcMock).toHaveBeenNthCalledWith(2, 'complete_firecrawl_transcript_recovery_target', expect.objectContaining({
      p_video_id: 'video-8',
      p_status: 'fetched',
    }))
    expect(fetcher).not.toHaveBeenCalled()
  })
})
