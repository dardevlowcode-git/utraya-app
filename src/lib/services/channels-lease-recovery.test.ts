/* Commento didattico:
 * Scopo del file: testa il recovery lease degli scan senza database reale.
 * Moduli richiamati: `processPendingScanJobs` con client admin mockato a catene, `vitest`.
 * Flusso: simula code pending/running/legacy e verifica requeue, payload invalidi e conteggi.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processPendingScanJobs } from './channels'

const { createAdminClientMock, createClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

// Catena Supabase generica: ogni metodo restituisce un builder attesa-compatibile.
// `update` registra il payload per asserire le transizioni di recovery.
function builder(value: unknown, updates: unknown[]) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (entry: unknown) => void) => Promise.resolve(value).then(resolve)
        if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(value)
        if (prop === 'update') {
          return (payload: unknown) => {
            updates.push(payload)
            return builder(value, updates)
          }
        }
        return (..._args: unknown[]) => builder(value, updates)
      },
    }
  )
}

describe('processPendingScanJobs recovery', () => {
  let queue: unknown[]
  let updates: unknown[]
  const fromMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    queue = []
    updates = []
    fromMock.mockImplementation(() => builder(queue.length > 0 ? queue.shift() : { error: null }, updates))
    createAdminClientMock.mockReturnValue({ from: fromMock })
  })

  it('non processa nulla con code vuote', async () => {
    queue.push({ data: [], error: null }, { data: [], error: null }, { data: [], error: null })
    await expect(processPendingScanJobs(5)).resolves.toEqual({ processed: 0, failed: 0 })
  })

  it('marca failed i job con payload non valido', async () => {
    queue.push(
      { data: [{ id: 'job-bad', payload: null, lease_id: null, lease_expires_at: null }], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { error: null }
    )
    await expect(processPendingScanJobs(5)).resolves.toEqual({ processed: 0, failed: 1 })
    expect(updates).toContainEqual(expect.objectContaining({ status: 'failed', error_message: 'invalid_payload' }))
  })

  it('riaccoda i job legacy senza lease e non li conta come falliti', async () => {
    queue.push(
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ id: 'job-legacy', payload: { userId: 'u1', channelId: 'c1' }, lease_id: null, lease_expires_at: null, started_at: '2026-01-01T00:00:00.000Z' }], error: null },
      { error: null },
      { data: null, error: null }
    )
    await expect(processPendingScanJobs(5)).resolves.toEqual({ processed: 0, failed: 0 })
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending', error_message: 'requeued_without_lease' }))
  })

  it('riaccoda le lease scadute con fencing sulla lease', async () => {
    queue.push(
      { data: [], error: null },
      { data: [{ id: 'job-stale', payload: { userId: 'u1', channelId: 'c1' }, lease_id: 'lease-old', lease_expires_at: '2026-01-01T00:00:00.000Z', started_at: '2026-01-01T00:00:00.000Z' }], error: null },
      { data: [], error: null },
      { error: null },
      { data: null, error: null }
    )
    await expect(processPendingScanJobs(5)).resolves.toEqual({ processed: 0, failed: 0 })
    expect(updates).toContainEqual(expect.objectContaining({ status: 'pending', error_message: 'requeued_after_timeout' }))
  })
})
