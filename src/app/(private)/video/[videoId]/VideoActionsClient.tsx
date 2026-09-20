/* Commento didattico:
 * Scopo del file: gestisce le azioni utente sul video (visto/non visto, watchlist) lato client.
 * Moduli richiamati: `react`
 * Flusso: invia richieste all'API `/api/videos`, aggiorna stato locale bottoni e mostra feedback minimale.
 */

'use client'

import { useState } from 'react'

interface VideoActionsClientProps {
  videoId: string
  initialSeen: boolean
  initialInWatchlist: boolean
  labels: {
    markSeen: string
    markUnseen: string
    addToWatchlist: string
    removeFromWatchlist: string
    genericError: string
  }
}

/**
 * Bottoni azione video con aggiornamento immediato stato locale.
 */
export default function VideoActionsClient(props: VideoActionsClientProps) {
  const [isSeen, setIsSeen] = useState(props.initialSeen)
  const [isInWatchlist, setIsInWatchlist] = useState(props.initialInWatchlist)
  const [loadingSeen, setLoadingSeen] = useState(false)
  const [loadingWatchlist, setLoadingWatchlist] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleSeen() {
    if (loadingSeen) return
    setLoadingSeen(true)
    setError(null)

    const nextSeen = !isSeen

    try {
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_seen_status',
          videoId: props.videoId,
          seenStatus: nextSeen ? 'seen' : 'unseen',
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error ?? props.labels.genericError)
      }

      setIsSeen(nextSeen)
    } catch (e) {
      setError(e instanceof Error ? e.message : props.labels.genericError)
    } finally {
      setLoadingSeen(false)
    }
  }

  async function toggleWatchlist() {
    if (loadingWatchlist) return
    setLoadingWatchlist(true)
    setError(null)

    const nextInWatchlist = !isInWatchlist

    try {
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_watchlist',
          videoId: props.videoId,
          inWatchlist: nextInWatchlist,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error ?? props.labels.genericError)
      }

      setIsInWatchlist(nextInWatchlist)
    } catch (e) {
      setError(e instanceof Error ? e.message : props.labels.genericError)
    } finally {
      setLoadingWatchlist(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSeen}
          disabled={loadingSeen}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-sm transition-all
                     disabled:opacity-60 disabled:cursor-not-allowed ${
                       isSeen
                         ? 'bg-green-600 text-white hover:bg-green-500'
                         : 'bg-surface-container-low hover:bg-surface-container text-on-surface'
                     }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {isSeen ? props.labels.markUnseen : props.labels.markSeen}
        </button>

        <button
          type="button"
          onClick={toggleWatchlist}
          disabled={loadingWatchlist}
          className="flex items-center gap-2 bg-surface-container-low hover:bg-surface-container
                     text-on-surface px-5 py-2.5 rounded-full font-semibold text-sm transition-all
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
          </svg>
          {isInWatchlist ? props.labels.removeFromWatchlist : props.labels.addToWatchlist}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : null}
    </div>
  )
}
