/* Commento didattico:
 * Scopo del file: gestisce le azioni rapide visto/non visto e nascosto nella lista tracker.
 * Moduli richiamati: `react`
 * Flusso: al click invia la richiesta API e aggiorna lo stato locale per riflettere subito i filtri selezionati.
 */

'use client'

import { useState } from 'react'

interface SeenStatusButtonProps {
  videoId: string
  initialStatus: 'seen' | 'unseen' | 'hidden'
  initialSeenAt?: string | null
  initialHiddenAt?: string | null
  labels: {
    seen: string
    unseen: string
    hidden: string
    markSeen: string
    markUnseen: string
    hide: string
    unhide: string
    error: string
  }
  onStatusChange?: (nextState: { seenStatus: 'seen' | 'unseen' | 'hidden'; seenAt: string | null; hiddenAt: string | null }) => void
  variant?: 'badge' | 'button'
}

export default function SeenStatusButton({
  videoId,
  initialStatus,
  initialSeenAt = null,
  initialHiddenAt = null,
  labels,
  onStatusChange,
  variant = 'button',
}: SeenStatusButtonProps) {
  const [status, setStatus] = useState<'seen' | 'unseen' | 'hidden'>(initialStatus)
  const [seenAt, setSeenAt] = useState<string | null>(initialSeenAt)
  const [hiddenAt, setHiddenAt] = useState<string | null>(initialHiddenAt)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setVideoStatus(nextStatus: 'seen' | 'unseen' | 'hidden') {
    if (loading) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_seen_status',
          videoId,
          seenStatus: nextStatus,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error ?? labels.error)
      }

      const resolvedSeenAt = typeof payload?.data?.seenAt === 'string'
        ? payload.data.seenAt
        : nextStatus === 'seen'
          ? seenAt
          : null
      const resolvedHiddenAt = typeof payload?.data?.hiddenAt === 'string'
        ? payload.data.hiddenAt
        : nextStatus === 'hidden'
          ? hiddenAt
          : null

      setStatus(nextStatus)
      setSeenAt(resolvedSeenAt)
      setHiddenAt(resolvedHiddenAt)
      onStatusChange?.({
        seenStatus: nextStatus,
        seenAt: resolvedSeenAt,
        hiddenAt: resolvedHiddenAt,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.error)
    } finally {
      setLoading(false)
    }
  }

  function toggleSeenStatus() {
    const nextStatus = status === 'seen' ? 'unseen' : 'seen'
    return setVideoStatus(nextStatus)
  }

  function toggleHiddenStatus() {
    const nextStatus = status === 'hidden' ? 'unseen' : 'hidden'
    return setVideoStatus(nextStatus)
  }

  const isSeen = status === 'seen'
  const isHidden = status === 'hidden'

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleSeenStatus}
          disabled={loading}
          aria-label={isSeen ? labels.markUnseen : labels.markSeen}
          title={isSeen ? labels.markUnseen : labels.markSeen}
          className={
            variant === 'badge'
              ? `px-2.5 py-1 text-[10px] font-bold uppercase rounded-full transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                isSeen
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-primary-fixed text-on-primary-fixed hover:brightness-95'
              }`
              : `px-4 py-2 rounded-full text-xs font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                isSeen
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-primary text-on-primary hover:bg-primary-container'
              }`
          }
        >
          {isSeen ? labels.seen : labels.unseen}
        </button>
        <button
          type="button"
          onClick={toggleHiddenStatus}
          disabled={loading}
          aria-label={isHidden ? labels.unhide : labels.hide}
          title={isHidden ? labels.unhide : labels.hide}
          className={
            variant === 'badge'
              ? `px-2.5 py-1 text-[10px] font-bold uppercase rounded-full transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                isHidden
                  ? 'bg-error text-white hover:brightness-95'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`
              : `px-4 py-2 rounded-full text-xs font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                isHidden
                  ? 'bg-error text-white hover:brightness-95'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`
          }
        >
          {isHidden ? labels.hidden : labels.hide}
        </button>
      </div>
      {error ? <p className="text-[11px] text-error">{error}</p> : null}
    </div>
  )
}
