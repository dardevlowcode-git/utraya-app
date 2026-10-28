import type { CredentialStatus } from '@/lib/types/domain'

export function toIntegrationApiView(status: CredentialStatus) {
  return {
    provider: status.provider,
    isConfigured: status.isConfigured,
    isValid: status.isValid,
    validationStatus: status.validationStatus,
    lastValidatedAt: status.lastValidatedAt,
    lastUsedAt: status.lastUsedAt,
    hasValidationError: Boolean(status.lastError),
    maskedKey: status.maskedKey,
  }
}
