/* Commento didattico:
 * Scopo del file: prova che il servizio dei job nasconda a ogni utente le righe di un altro proprietario.
 * Moduli richiamati: `user-jobs`, fake Supabase con filtri applicati e `vitest`.
 * Flusso: A legge il proprio job mentre una query per il job di B deve apparire come inesistente.
 */

import { describe, expect, it } from 'vitest'
import { createFilteringSupabase } from '@/__tests__/helpers/filteringSupabase'
import { getUserJobStatus } from '@/lib/services/user-jobs'

describe('getUserJobStatus', () => {
  it('restituisce il job di A ma nasconde quello di B come non trovato', async () => {
    const fake = createFilteringSupabase({
      jobs: [
        {
          id: 'job-a',
          created_by_user_id: 'user-a',
          job_type: 'sync_channel_delta',
          status: 'completed',
          created_at: '2026-10-20T10:00:00.000Z',
          started_at: '2026-10-20T10:01:00.000Z',
          completed_at: '2026-10-20T10:02:00.000Z',
        },
        {
          id: 'job-b',
          created_by_user_id: 'user-b',
          job_type: 'sync_channel_delta',
          status: 'running',
          created_at: '2026-10-20T11:00:00.000Z',
          started_at: '2026-10-20T11:01:00.000Z',
          completed_at: null,
        },
      ],
    })

    await expect(getUserJobStatus({ userId: 'user-a', jobId: 'job-a', supabase: fake.client }))
      .resolves.toMatchObject({ id: 'job-a', type: 'sync_channel_delta', status: 'completed' })

    await expect(getUserJobStatus({ userId: 'user-a', jobId: 'job-b', supabase: fake.client }))
      .rejects.toMatchObject({ statusCode: 404, message: 'Job non trovato' })
  })
})
