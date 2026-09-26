/* Commento didattico:
 * Scopo del file: converte il contesto canale interno nel view model pubblico `/api/v1`.
 * Moduli richiamati: `@/lib/services/channels`.
 * Flusso: elimina row Supabase e mantiene solo metadati canale, preferenze utente e stato sync leggibile.
 */

import type { getChannelsForUser } from '@/lib/services/channels'

export function toChannelApiView(item: Awaited<ReturnType<typeof getChannelsForUser>>[number]) {
  return {
    id: item.channel.id,
    youtubeChannelId: item.channel.youtube_channel_id,
    handle: item.channel.handle,
    title: item.channel.title,
    description: item.channel.description,
    thumbnailUrl: item.channel.thumbnail_url,
    customUrl: item.channel.custom_url,
    addedAt: item.userChannel.added_at,
    preferences: item.preferences
      ? { syncFrequencyHours: item.preferences.sync_frequency_hours, paused: item.preferences.is_paused }
      : null,
    sync: item.syncState
      ? {
          lastSyncAt: item.syncState.last_sync_at,
          status: item.syncState.last_sync_status,
          videosFound: item.syncState.videos_found_count,
        }
      : null,
  }
}
