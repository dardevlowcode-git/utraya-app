/* Commento didattico:
 * Scopo del file: verifica la scelta dello stato di scansione mostrato per un canale.
 * Moduli richiamati: view model stato scansione e `vitest`.
 * Flusso: il motivo pubblico del job pending diventa un avviso UI esplicito.
 */

import { describe, expect, it } from 'vitest'
import { getChannelScanNotice } from '@/lib/view-models/channel-scan-status'

describe('getChannelScanNotice', () => {
  it('segnala la scansione in attesa di una chiave YouTube', () => {
    expect(getChannelScanNotice('youtube_key_missing')).toBe('waiting_for_youtube_key')
  })

  it('non mostra un avviso per gli altri stati', () => {
    expect(getChannelScanNotice(null)).toBeNull()
    expect(getChannelScanNotice('timeout')).toBeNull()
  })
})
