/* Commento didattico:
 * Scopo del file: valore sensibile mascherato con occhio per-riga per la modalità presentazione in admin.
 * Moduli richiamati: `react`.
 * Flusso: il parent passa valore reale + valore mascherato + stato visible; il bottone occhio alterna solo quella riga.
 */

'use client'

interface MaskedFieldProps {
  value: string
  maskedValue: string
  visible: boolean
  onToggle: () => void
  showLabel: string
  hideLabel: string
  className?: string
}

function EyeIcon({ off }: { off: boolean }) {
  if (off) {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 3l18 18M10.5 5.2A9.8 9.8 0 0112 5c7 0 10 7 10 7a17.6 17.6 0 01-2.9 3.1M6.6 6.6A16.9 16.9 0 002 12s3 7 10 7a9.6 9.6 0 004.4-1.1M9.9 9.9a3 3 0 004.2 4.2"
        />
      </svg>
    )
  }
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zm10 3a3 3 0 100-6 3 3 0 000 6z"
      />
    </svg>
  )
}

export default function MaskedField({
  value,
  maskedValue,
  visible,
  onToggle,
  showLabel,
  hideLabel,
  className = '',
}: MaskedFieldProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{visible ? value : maskedValue}</span>
      <button
        type="button"
        onClick={onToggle}
        title={visible ? hideLabel : showLabel}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        className="rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
      >
        <EyeIcon off={visible} />
      </button>
    </span>
  )
}
