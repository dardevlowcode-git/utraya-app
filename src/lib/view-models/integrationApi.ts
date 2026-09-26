/* Commento didattico:
 * Scopo del file: converte lo stato credenziali interno nel view model pubblico API senza diagnostica provider.
 * Moduli richiamati: `@/lib/types/domain`.
 * Flusso: espone solo stato, timestamp, maschera e booleano errore; il messaggio provider resta server-side.
 */

import type { CredentialStatus } from '@/lib/types/domain'

export function toIntegrationApiView(status: CredentialStatus) {
  return {
    provider: status.provider,
    isConfigured: status.isConfigured,
    isValid: status.isValid,
    lastValidatedAt: status.lastValidatedAt,
    lastUsedAt: status.lastUsedAt,
    hasValidationError: Boolean(status.lastError),
    maskedKey: status.maskedKey,
  }
}
