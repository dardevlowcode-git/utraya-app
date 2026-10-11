/* Commento didattico:
 * Scopo del file: verifica che un worker faccia un solo tentativo provider e persista la continuazione.
 * Moduli richiamati: service credential-validation-jobs, client admin mock e vitest.
 * Flusso: simula claim/finish della lease e controlla budget alto senza dipendere dal provider.
 */

import { describe, expect, it, vi } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import {
  enqueueCredentialValidation,
  getCredentialValidationStatusesForUser,
  processCredentialValidationJob,
  processPendingCredentialValidationJobs,
  type CredentialValidationJobPayload,
  type CredentialValidationAttemptResult,
} from '@/lib/services/credential-validation-jobs'

const payload: CredentialValidationJobPayload = {
  credentialId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-1',
  provider: 'youtube',
  keyVersion: '00000000-0000-4000-8000-000000000002',
  retryLimit: 100_000,
}

describe('credential validation job lifecycle', () => {
  it('sospende un retry alto dopo un solo tentativo e salva il prossimo istante nel job', async () => {
    const completedAt = new Date('2026-10-11T12:00:00.000Z')
    const claim = {
      job_id: 'job-1',
      lease_id: 'lease-1',
      attempt_id: 'attempt-2',
      attempt_number: 2,
      payload,
    }
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown> = {}) => name === 'claim_credential_validation_job_with_attempt'
      ? { data: [claim], error: null }
      : { data: true, error: null })
    const adminClient = { rpc } as unknown as ReturnType<typeof createAdminClient>
    const attemptProvider = vi.fn<(jobPayload: CredentialValidationJobPayload) => Promise<CredentialValidationAttemptResult>>().mockResolvedValue({
      isValid: false,
      retryable: true,
      message: 'Temporary provider error',
      errorType: 'temporary',
      credentialChanged: false,
    })

    const result = await processCredentialValidationJob({
      jobId: 'job-1',
      attemptProvider,
      adminClient,
      now: completedAt,
      leaseId: 'lease-1',
    })

    expect(result).toMatchObject({ claimed: true, status: 'pending', attemptNumber: 2 })
    expect(attemptProvider).toHaveBeenCalledOnce()
    const finish = rpc.mock.calls.find(([name]) => name === 'finish_credential_validation_job_attempt')
    expect(finish?.[1] as Record<string, unknown>).toMatchObject({
      p_job_id: 'job-1',
      p_lease_id: 'lease-1',
      p_attempt_id: 'attempt-2',
      p_attempt_number: 2,
      p_status: 'pending',
      p_retry_limit: 100_000,
      p_completed_at: '2026-10-11T12:00:00.000Z',
    })
    expect((finish?.[1] as Record<string, unknown>).p_next_attempt_at).toBe('2026-10-11T12:00:02.000Z')
  })

  it('continua un budget alto in invocazioni distinte senza azzerare il numero attempt', async () => {
    let attemptNumber = 0
    const finishAttemptNumbers: number[] = []
    const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      if (name === 'claim_credential_validation_job_with_attempt') {
        attemptNumber += 1
        return {
          data: [{
            job_id: 'job-high-budget',
            lease_id: args.p_lease_id,
            attempt_id: `attempt-${attemptNumber}`,
            attempt_number: attemptNumber,
            payload,
          }],
          error: null,
        }
      }
      finishAttemptNumbers.push(Number(args.p_attempt_number))
      return { data: true, error: null }
    })
    const attemptProvider = vi.fn<(jobPayload: CredentialValidationJobPayload) => Promise<CredentialValidationAttemptResult>>().mockResolvedValue({
      isValid: false,
      retryable: true,
      message: 'Temporary provider error',
      errorType: 'temporary',
      credentialChanged: false,
    })
    const adminClient = { rpc } as unknown as ReturnType<typeof createAdminClient>
    const now = new Date('2026-10-11T12:00:00.000Z')

    const first = await processCredentialValidationJob({ jobId: 'job-high-budget', attemptProvider, adminClient, now })
    const second = await processCredentialValidationJob({ jobId: 'job-high-budget', attemptProvider, adminClient, now })

    expect(first).toMatchObject({ claimed: true, status: 'pending', attemptNumber: 1 })
    expect(second).toMatchObject({ claimed: true, status: 'pending', attemptNumber: 2 })
    expect(attemptProvider).toHaveBeenCalledTimes(2)
    expect(attemptProvider.mock.calls.map(([jobPayload]) => jobPayload)).toEqual([payload, payload])
    expect(finishAttemptNumbers).toEqual([1, 2])
  })

  it.each([
    { retryLimit: 0, attemptNumber: 1, expectedStatus: 'failed' },
    { retryLimit: 1, attemptNumber: 1, expectedStatus: 'pending' },
    { retryLimit: 1, attemptNumber: 2, expectedStatus: 'failed' },
    { retryLimit: 10, attemptNumber: 10, expectedStatus: 'pending' },
    { retryLimit: 10, attemptNumber: 11, expectedStatus: 'failed' },
  ] as const)('applica R=$retryLimit al tentativo $attemptNumber senza loop interni', async ({ retryLimit, attemptNumber, expectedStatus }) => {
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown> = {}) => name === 'claim_credential_validation_job_with_attempt'
      ? {
        data: [{
          job_id: 'job-limits',
          lease_id: 'lease-limits',
          attempt_id: `attempt-${attemptNumber}`,
          attempt_number: attemptNumber,
          payload: { ...payload, retryLimit },
        }],
        error: null,
      }
      : { data: true, error: null })
    const attemptProvider = vi.fn<() => Promise<CredentialValidationAttemptResult>>().mockResolvedValue({
      isValid: false,
      retryable: true,
      message: 'Temporary provider error',
      errorType: 'temporary',
      credentialChanged: false,
    })

    const result = await processCredentialValidationJob({
      jobId: 'job-limits',
      attemptProvider,
      adminClient: { rpc } as unknown as ReturnType<typeof createAdminClient>,
      now: new Date('2026-10-11T12:00:00.000Z'),
      leaseId: 'lease-limits',
    })

    expect(result.status).toBe(expectedStatus)
    expect(attemptProvider).toHaveBeenCalledOnce()
    const finish = rpc.mock.calls.find(([name]) => name === 'finish_credential_validation_job_attempt')
    expect(finish?.[1] as Record<string, unknown>).toMatchObject({ p_attempt_number: attemptNumber, p_retry_limit: retryLimit, p_status: expectedStatus })
  })

  it('non duplica una lease già acquisita da un altro worker', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }))
    const attemptProvider = vi.fn<() => Promise<CredentialValidationAttemptResult>>()

    const result = await processCredentialValidationJob({
      jobId: 'job-already-claimed',
      attemptProvider,
      adminClient: { rpc } as unknown as ReturnType<typeof createAdminClient>,
      now: new Date('2026-10-11T12:00:00.000Z'),
      leaseId: 'competing-lease',
    })

    expect(result).toEqual({ claimed: false, status: 'pending' })
    expect(attemptProvider).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('schedula job pending e recupera lease scadute nello stesso batch persistente', async () => {
    const selectedStatuses: string[] = []
    const from = vi.fn(() => {
      let selectedStatus = ''
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => {
          if (column === 'status') {
            selectedStatus = value
            selectedStatuses.push(value)
          }
          return query
        }),
        lte: vi.fn(() => query),
        lt: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(async () => ({
          data: selectedStatus === 'pending' ? [{ id: 'pending-job' }] : [{ id: 'expired-job' }],
          error: null,
        })),
      }
      return query
    })
    const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => name === 'claim_credential_validation_job_with_attempt'
      ? {
        data: [{
          job_id: args.p_job_id,
          lease_id: args.p_lease_id,
          attempt_id: `attempt-${args.p_job_id}`,
          attempt_number: args.p_job_id === 'pending-job' ? 1 : 2,
          payload: { ...payload, retryLimit: 10 },
        }],
        error: null,
      }
      : { data: true, error: null })
    const adminClient = { from, rpc } as unknown as ReturnType<typeof createAdminClient>
    const attemptProvider = vi.fn<() => Promise<CredentialValidationAttemptResult>>().mockResolvedValue({
      isValid: true,
      retryable: false,
      message: null,
      errorType: null,
      credentialChanged: false,
    })

    const result = await processPendingCredentialValidationJobs({
      adminClient,
      attemptProvider,
      now: new Date('2026-10-11T12:00:00.000Z'),
      batchLimit: 3,
    })

    expect(selectedStatuses.sort()).toEqual(['pending', 'running'])
    expect(attemptProvider).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls.filter(([name]) => name === 'claim_credential_validation_job_with_attempt')
      .map(([, args]) => (args as Record<string, unknown>).p_job_id).sort())
      .toEqual(['expired-job', 'pending-job'])
    expect(result).toEqual({ claimed: 2, completed: 2, pending: 0, failed: 0 })
  })

  it('deduplica enqueue concorrenti per la stessa versione ma consente una versione nuova', async () => {
    let activeJob: { id: string; status: 'pending' | 'running'; keyVersion: string } | null = null
    let insertCount = 0
    let requestedKeyVersion = ''
    const activeQuery = {
      eq: vi.fn(() => activeQuery),
      in: vi.fn(() => activeQuery),
      contains: vi.fn((_column: string, filter: Record<string, string>) => {
        requestedKeyVersion = filter.keyVersion
        return activeQuery
      }),
      maybeSingle: vi.fn(async () => ({ data: activeJob?.keyVersion === requestedKeyVersion ? activeJob : null, error: null })),
    }
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => activeQuery),
        insert: vi.fn((values: Record<string, unknown>) => {
          insertCount += 1
          const payload = values.payload as CredentialValidationJobPayload
          activeJob = { id: `job-${insertCount}`, status: 'pending', keyVersion: payload.keyVersion }
          return {
            select: vi.fn(() => ({ single: vi.fn(async () => ({ data: activeJob, error: null })) })),
            values,
          }
        }),
      })),
    } as unknown as ReturnType<typeof createAdminClient>

    const first = await enqueueCredentialValidation(payload, admin)
    const repeated = await enqueueCredentialValidation(payload, admin)
    const replaced = await enqueueCredentialValidation({ ...payload, keyVersion: 'next-key-version' }, admin)

    expect(first).toEqual({ jobId: 'job-1', status: 'pending' })
    expect(repeated).toEqual(first)
    expect(replaced).toEqual({ jobId: 'job-2', status: 'pending' })
    expect(insertCount).toBe(2)
  })

  it('espone pending solo per la versione corrente della chiave proprietaria', async () => {
    const activeQuery = {
      eq: vi.fn(() => activeQuery),
      in: vi.fn(async () => ({
        data: [
          { status: 'pending', payload: payload },
          { status: 'running', payload: { ...payload, keyVersion: 'replaced-key-version' } },
        ],
        error: null,
      })),
    }
    const supabase = ({ from: vi.fn(() => ({ select: vi.fn(() => activeQuery) })) }) as unknown as Parameters<typeof getCredentialValidationStatusesForUser>[1]

    const statuses = await getCredentialValidationStatusesForUser('user-1', supabase, new Map([
      [payload.credentialId, payload.keyVersion],
    ]))

    expect(statuses).toEqual(new Map([[payload.credentialId, 'pending']]))
  })
})
