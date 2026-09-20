/* Commento didattico:
 * Scopo del file: definisce il view model dello stato richiesta cancellazione account utente.
 * Moduli richiamati: nessuno.
 * Flusso: servizi account deletion calcolano questo modello per UI impostazioni account.
 */

export type DeletionRequestView = {
  status: 'none' | 'pending' | 'cancelled' | 'completed'
  scheduledFor: string | null
  requestedAt: string | null
  canCancel: boolean
  daysRemaining: number | null
  cancelToken: string | null
}