/* Commento didattico:
 * Scopo del file: converte il contesto video interno in un view model pubblico stabile per mobile/API.
 * Moduli richiamati: `@/lib/types/domain`.
 * Flusso: esclude raw metadata, errori provider e nomi DB snake_case prima della serializzazione.
 */

import type { VideoWithContext } from '@/lib/types/domain'

export function toVideoApiView(item: VideoWithContext) {
  return {
    id: item.video.id,
    channelId: item.video.channel_id,
    youtubeVideoId: item.video.youtube_video_id,
    title: item.video.title,
    description: item.video.description,
    thumbnailUrl: item.video.thumbnail_url,
    publishedAt: item.video.published_at,
    durationSeconds: item.video.duration_seconds,
    videoUrl: item.video.video_url,
    type: item.video.video_type,
    availabilityStatus: item.video.availability_status,
    createdAt: item.video.created_at,
    updatedAt: item.video.updated_at,
    channel: {
      id: item.channel.id,
      youtubeChannelId: item.channel.youtube_channel_id,
      handle: item.channel.handle,
      title: item.channel.title,
      description: item.channel.description,
      thumbnailUrl: item.channel.thumbnail_url,
      customUrl: item.channel.custom_url,
      status: item.channel.status,
    },
    analysis: item.analysis
      ? {
          id: item.analysis.id,
          status: item.analysis.analysis_status,
          model: item.analysis.model_used,
          analyzedAt: item.analysis.analyzed_at,
        }
      : null,
    localizedContent: item.localizedContent
      ? {
          languageCode: item.localizedContent.language_code,
          shortSummary: item.localizedContent.short_summary,
          fullSummary: item.localizedContent.full_summary,
          generalCategory: item.localizedContent.general_category,
          subcategory: item.localizedContent.subcategory,
          highlightsText: item.localizedContent.highlights_text,
          updatedAt: item.localizedContent.updated_at,
        }
      : null,
    userState: item.userState,
  }
}

export function toVideoListApiView(data: {
  items: VideoWithContext[]
  page: number
  limit: number
  total: number
}) {
  return {
    items: data.items.map(toVideoApiView),
    page: data.page,
    limit: data.limit,
    total: data.total,
  }
}
