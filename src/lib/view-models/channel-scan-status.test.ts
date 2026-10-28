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
