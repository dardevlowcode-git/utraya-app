/* Commento didattico:
 * Scopo del file: trasforma motivi interni/pubblici della scansione nello stato da mostrare nella UI canali.
 * Moduli richiamati: nessuno; contiene una proiezione pura e serializzabile.
 * Flusso: il motivo d'attesa YouTube viene convertito in una chiave di presentazione localizzata.
 */

export type ChannelScanNotice = 'waiting_for_youtube_key'

/** Seleziona un avviso UI quando la scansione e` sospesa per una chiave YouTube non disponibile. */
export function getChannelScanNotice(waitingReason: unknown, warningCode?: unknown): ChannelScanNotice | null {
  if (waitingReason === 'youtube_key_missing' || warningCode === 'missing_youtube_api_key') {
    return 'waiting_for_youtube_key'
  }
  return null
}
