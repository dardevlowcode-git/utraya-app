/* Commento didattico:
 * Scopo del file: tabella client ridimensionabile per la sezione operazioni/job falliti.
 * Moduli richiamati: `react`, `@/components/admin/useResizableColumns`
 * Flusso: riceve righe pronte dal server e gestisce solo rendering + resize colonne.
 */

'use client'

import { useResizableColumns } from '@/components/admin/useResizableColumns'

interface FailedJobRow {
  id: string
  label: string
  errorMessage: string
  errorDetail: string | null
  timestampIso: string
  attemptLabel: string
}

interface FailedJobsTableClientProps {
  rows: FailedJobRow[]
  emptyLabel: string
  locale: string
}

export default function FailedJobsTableClient({ rows, emptyLabel, locale }: FailedJobsTableClientProps) {
  const { templateColumns, onStartResize } = useResizableColumns([360, 250, 360, 170, 120], { minWidth: 90 })

  return (
    <div className="bg-surface-container-lowest rounded-2xl overflow-auto shadow-ambient max-h-[420px]">
      <div className="min-w-max">
        <div className="grid px-5 py-3 bg-surface-container-low" style={{ gridTemplateColumns: templateColumns }}>
          {['Job', 'Errore', 'Dettaglio', 'Quando', 'Tentativo'].map((label, index, arr) => (
            <div key={label} className="relative pr-3">
              <p className={`text-label-caps text-on-surface-variant ${index === arr.length - 1 ? 'text-right' : ''}`}>
                {label}
              </p>
              {index < arr.length - 1 && (
                <button
                  type="button"
                  aria-label={`Resize ${label}`}
                  onMouseDown={(event) => onStartResize(index, event.clientX)}
                  className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-primary/20"
                />
              )}
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="text-on-surface-variant text-center py-8 px-4">{emptyLabel}</p>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.id}
              className={`grid px-5 py-4 border-b border-surface-container-high last:border-0
                           ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}
              style={{ gridTemplateColumns: templateColumns }}
            >
              <p className="text-sm font-semibold text-on-surface truncate pr-3">{row.label}</p>
              <p className="text-xs text-error truncate pr-3">{row.errorMessage}</p>
              <p className="text-[11px] text-on-surface-variant truncate pr-3" title={row.errorDetail ?? '—'}>
                {row.errorDetail ?? '—'}
              </p>
              <p className="text-xs text-outline pr-3">
                {new Date(row.timestampIso).toLocaleString(locale)}
              </p>
              <p className="text-xs text-on-surface-variant text-right">{row.attemptLabel}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
