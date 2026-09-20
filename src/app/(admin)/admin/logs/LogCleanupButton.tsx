/* Commento didattico:
 * Scopo del file: pulsante client per pulizia reale dei log da console admin.
 * Moduli richiamati: `react`, `next/navigation`
 * Flusso: invia richiesta POST al backend admin e ricarica i dati della pagina con `router.refresh()`.
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type CleanupType = 'failed_jobs' | 'app_logs' | 'audit_logs'

interface LogCleanupButtonProps {
  type: CleanupType
  label: string
  confirmMessage: string
  disabled?: boolean
}

export default function LogCleanupButton({ type, label, confirmMessage, disabled = false }: LogCleanupButtonProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCleanup() {
    if (disabled || busy) return
    if (!window.confirm(confirmMessage)) return

    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/logs/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as
        | { error?: string | null; data?: { message?: string } | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Errore pulizia log')
      }

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore pulizia log')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleCleanup}
        disabled={disabled || busy}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-error border border-error/40
                   hover:bg-error-container/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Pulizia…' : label}
      </button>
      {error && <p className="text-[11px] text-error">{error}</p>}
    </div>
  )
}

