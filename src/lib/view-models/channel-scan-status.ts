export type ChannelScanNotice = 'waiting_for_youtube_key'

/** Seleziona un avviso UI quando la scansione e` sospesa per una chiave YouTube non disponibile. */
export function getChannelScanNotice(waitingReason: unknown, warningCode?: unknown): ChannelScanNotice | null {
  if (waitingReason === 'youtube_key_missing' || warningCode === 'missing_youtube_api_key') {
    return 'waiting_for_youtube_key'
  }
  return null
}
