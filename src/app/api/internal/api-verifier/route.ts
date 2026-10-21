/* Commento didattico:
 * Scopo del file: registra l'endpoint HTTP interno del verificatore API.
 * Moduli richiamati: `@/lib/verifier/api-verifier-broker`.
 * Flusso: espone solo la configurazione Next e delega la richiesta al controller.
 */

export const runtime = 'nodejs'
export const maxDuration = 300

export { POST } from '@/lib/verifier/api-verifier-broker'
