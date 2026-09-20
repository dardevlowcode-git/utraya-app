/* Commento didattico:
 * Scopo del file: definisce codici errore applicativi condivisi per le API nuove in envelope standard.
 * Moduli richiamati: nessuno.
 * Flusso: i route handler usano questi codici con `apiErr` per risposte consistenti e tracciabili.
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'LEGAL_ACCEPTANCE_FAILED'
  | 'ACCOUNT_DELETION_FAILED'
  | 'CRON_UNAUTHORIZED'
  | 'CRON_MISCONFIGURED'