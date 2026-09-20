/* Commento didattico:
 * Scopo del file: pulsante client per avviare scansione immediata da console super-admin.
 * Moduli richiamati: `react`, `next-intl`
 * Flusso: invia POST all'endpoint admin scan-now e mostra feedback locale.
 */

'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface AdminScanNowButtonProps {
  channelId: string
}

export default function AdminScanNowButton({ channelId }: AdminScanNowButtonProps) {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function triggerScanNow() {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/admin/channels/${channelId}/scan-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as
        | { data?: { message?: string }; error?: string | null }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? t('admin.channels.scanError'))
      }

      setMessage(payload?.data?.message ?? t('admin.channels.scanStarted'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.channels.scanError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={triggerScanNow}
        disabled={busy}
        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-primary
                   hover:bg-primary-fixed transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? t('common.loading') : t('admin.channels.scanNowAdmin')}
      </button>
      {message && <p className="text-[11px] text-green-700">{message}</p>}
      {error && <p className="text-[11px] text-error">{error}</p>}
    </div>
  )
}
