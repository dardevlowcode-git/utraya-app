/* Commento didattico:
 * Scopo del file: form client per registrare accettazione TOS e clausole vessatorie con doppia checkbox separata.
 * Moduli richiamati: `next/navigation`, view model legal acceptance.
 * Flusso: abilita submit solo con doppia spunta, invia POST `/api/legal/accept` e reindirizza a dashboard.
 */

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegalAcceptanceView } from '@/lib/view-models/legalAcceptance'

export default function LegalAcceptanceClient({ status }: { status: LegalAcceptanceView }) {
  const router = useRouter()
  const [acceptTos, setAcceptTos] = useState(false)
  const [acceptVex, setAcceptVex] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = acceptTos && acceptVex && !loading

  async function submitAcceptance() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/legal/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kinds: ['tos', 'tos_vexatorious'], locale: status.currentLocale }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
        throw new Error(payload?.error?.message ?? 'Impossibile registrare l\'accettazione')
      }

      router.push('/dashboard')
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Errore durante la conferma')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 pb-20 pt-14">
      <div className="rounded-3xl bg-surface-container-low p-8 shadow-ambient">
        <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">Prima di iniziare</h1>
        <p className="mt-3 text-sm text-on-surface-variant">
          Per continuare devi confermare i Termini di Servizio e approvare separatamente le clausole vessatorie.
        </p>

        <div className="mt-6 space-y-3 text-sm text-on-surface">
          <Link className="underline underline-offset-4 hover:text-light-signal-orange" href="/legal/termini" target="_blank">
            Leggi i Termini completi (v {status.tosVersion})
          </Link>
          <br />
          <Link className="underline underline-offset-4 hover:text-light-signal-orange" href="/legal/termini#22-applicazione-specifica-delle-clausole-vessatorie-art-1341-cc-comma-2" target="_blank">
            Leggi clausole vessatorie (v {status.tosVexVersion})
          </Link>
          <br />
          <Link className="underline underline-offset-4 hover:text-light-signal-orange" href="/legal/privacy" target="_blank">
            Leggi Informativa Privacy (v {status.privacyVersion})
          </Link>
        </div>

        <div className="mt-8 space-y-4">
          <label className="flex items-start gap-3 text-sm text-on-surface">
            <input type="checkbox" checked={acceptTos} onChange={(event) => setAcceptTos(event.target.checked)} className="mt-1" />
            <span>
              Ho letto e accetto i Termini di Servizio (versione <strong>{status.tosVersion}</strong>) e confermo di aver letto
              l&apos;informativa Privacy (versione <strong>{status.privacyVersion}</strong>).
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-outline-variant/70 bg-surface-container-lowest p-3 text-sm text-on-surface">
            <input type="checkbox" checked={acceptVex} onChange={(event) => setAcceptVex(event.target.checked)} className="mt-1" />
            <span>
              <strong>
                Ai sensi dell&apos;art. 1341 c.c. comma 2 approvo specificamente le clausole vessatorie (§11, §13, §15, §16, §17,
                §18).
              </strong>
            </span>
          </label>
        </div>

        {error && <p className="mt-4 text-sm text-error">{error}</p>}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={submitAcceptance}
            disabled={!canSubmit}
            className="shell-cta-default px-6 py-3 disabled:opacity-50"
          >
            {loading ? 'Conferma in corso...' : 'Continua su Utraya'}
          </button>

          <Link href="/settings/account" className="self-center text-sm text-on-surface-variant underline underline-offset-4 hover:text-light-signal-orange">
            Non accetto e voglio cancellare l&apos;account
          </Link>
        </div>
      </div>
    </div>
  )
}
