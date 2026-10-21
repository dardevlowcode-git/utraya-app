/* Commento didattico:
 * Scopo del file: registra gli handler HTTP per l'endpoint v1 video.
 * Moduli richiamati: `@/lib/api/v1/videoHandlers`.
 * Flusso: espone solo configurazione Next e delega le richieste al controller.
 */

export const runtime = 'nodejs'
export const maxDuration = 300

export { GET, POST } from '@/lib/api/v1/videoHandlers'
