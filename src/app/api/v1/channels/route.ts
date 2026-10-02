/* Commento didattico:
 * Scopo del file: registra gli handler HTTP per l'endpoint v1 canali.
 * Moduli richiamati: `@/lib/api/v1/channelHandlers`.
 * Flusso: espone solo configurazione Next e delega le richieste al controller.
 */

export const runtime = 'nodejs'
export const maxDuration = 300

export { DELETE, GET, POST } from '@/lib/api/v1/channelHandlers'
