/* Commento didattico:
 * Scopo del file: client UI per richiesta/annullamento cancellazione account con feedback immediato all'utente.
 * Moduli richiamati: `react`, `next/navigation`, view model deletion.
 * Flusso: invia DELETE/POST agli endpoint account e aggiorna lo stato visualizzato locale.
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DeletionRequestView } from '@/lib/view-models/deletion'

export default function AccountDeletionClient({ initialState }: { initialState: DeletionRequestView }) {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [reason, setReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestDeletionNow() {
    if (!confirmDelete || loading) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || null }),
      })
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; data?: { scheduledFor?: string }; error?: { message?: string } } | null

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? 'Errore richiesta cancellazione')
      }

      setState((previous) => ({
        ...previous,
        status: 'pending',
        scheduledFor: payload.data?.scheduledFor ?? previous.scheduledFor,
        canCancel: true,
      }))

      router.push('/login?error=deletion_pending')
      router.refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Errore')
    } finally {
      setLoading(false)
    }
  }

  async function cancelDeletionNow() {
    if (!state.cancelToken || loading) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/account/cancel-deletion?token=${encodeURIComponent(state.cancelToken)}`, {
        method: 'POST',
      })
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? 'Errore annullamento cancellazione')
      }

      setState((previous) => ({
        ...previous,
        status: 'cancelled',
        canCancel: false,
      }))
      router.refresh()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Errore')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-6">
      <h2 className="text-xl font-bold text-on-surface">Cancella il tuo account</h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        La cancellazione rimuove i dati personali entro 30 giorni. Durante il grace period puoi annullare.
      </p>

      {state.status === 'pending' && (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Cancellazione programmata per: <strong>{state.scheduledFor ? new Date(state.scheduledFor).toLocaleString('it-IT') : 'n/d'}</strong>
          {state.daysRemaining !== null && <span> · Giorni rimanenti: {state.daysRemaining}</span>}
          <div className="mt-3">
            <button
              type="button"
              onClick={cancelDeletionNow}
              disabled={!state.canCancel || loading}
              className="rounded-full border border-amber-700 px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {loading ? 'Annullamento...' : 'Annulla cancellazione'}
            </button>
          </div>
        </div>
      )}

      {state.status !== 'pending' && (
        <>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Motivo (opzionale)"
            className="mt-4 w-full rounded-xl border border-outline-variant/60 bg-surface px-3 py-2 text-sm"
          />

          <label className="mt-3 flex items-start gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={confirmDelete} onChange={(event) => setConfirmDelete(event.target.checked)} className="mt-1" />
            <span>Confermo di voler avviare la cancellazione del mio account (irreversibile a fine grace period).</span>
          </label>

          <button
            type="button"
            onClick={requestDeletionNow}
            disabled={!confirmDelete || loading}
            className="mt-4 shell-cta-accent disabled:opacity-50"
          >
            {loading ? 'Invio richiesta...' : 'Cancella il mio account'}
          </button>
        </>
      )}

      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </section>
  )
}
