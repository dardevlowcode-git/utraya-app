/* Commento didattico:
 * Scopo del file: fornisce funzioni di utilita` riusabili in piu` punti del progetto.
 * Moduli richiamati: `@/lib/types/domain`
 * Flusso: Le utility vengono richiamate da moduli diversi per evitare duplicazioni e standardizzare comportamenti comuni.
 */

import type { ParsedYouTubeUrl } from '@/lib/types/domain'

/**
 * Parses a YouTube channel URL and extracts the channel identifier.
 *
 * Supported formats (V1):
 * - https://www.youtube.com/@handle
 * - https://www.youtube.com/channel/UC...
 *
 * NOT supported in V1:
 * - Video URLs
 * - Playlist URLs
 * - Arbitrary vanity/custom URLs
 */
export function parseYouTubeChannelUrl(input: string): ParsedYouTubeUrl {
  const trimmed = input.trim()

  // Handle case where user pastes just a handle like "@veritasium"
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1)
    if (isValidHandle(handle)) {
      return { type: 'handle', value: handle, originalUrl: trimmed }
    }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { type: 'invalid', value: '', originalUrl: trimmed }
  }

  // Must be youtube.com domain
  if (!isYouTubeDomain(url.hostname)) {
    return { type: 'invalid', value: '', originalUrl: trimmed }
  }

  const pathname = url.pathname

  // Format: /channel/UCxxxxxx
  const channelMatch = pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})$/)
  if (channelMatch) {
    return {
      type: 'channel_id',
      value: channelMatch[1],
      originalUrl: trimmed,
    }
  }

  // Format: /@handle
  const handleMatch = pathname.match(/^\/@([a-zA-Z0-9._-]+)$/)
  if (handleMatch) {
    const handle = handleMatch[1]
    if (isValidHandle(handle)) {
      return { type: 'handle', value: handle, originalUrl: trimmed }
    }
  }

  return { type: 'invalid', value: '', originalUrl: trimmed }
}

function isYouTubeDomain(hostname: string): boolean {
  return hostname === 'youtube.com' || hostname === 'www.youtube.com'
}

/**
 * Valida sintatticamente un handle YouTube secondo il formato supportato in V1.
 */
function isValidHandle(handle: string): boolean {
  // YouTube handles: 3-30 chars, alphanumeric + dots, underscores, hyphens
  return /^[a-zA-Z0-9._-]{3,30}$/.test(handle)
}

/**
 * Normalizes a channel URL to a canonical format for deduplication.
 */
export function normalizeChannelUrl(parsed: ParsedYouTubeUrl): string {
  if (parsed.type === 'handle') {
    return `https://www.youtube.com/@${parsed.value}`
  }
  if (parsed.type === 'channel_id') {
    return `https://www.youtube.com/channel/${parsed.value}`
  }
  return parsed.originalUrl
}
