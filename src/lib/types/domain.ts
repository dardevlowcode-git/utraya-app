/* Commento didattico:
 * Scopo del file: dichiara tipi TypeScript condivisi, utili per rendere il codice piu` sicuro e leggibile.
 * Moduli richiamati: `./database`
 * Flusso: I tipi dichiarati qui sono importati da servizi, API e componenti per controllare forma e coerenza dei dati.
 */

import type { Database } from './database'

// --- Convenience row types from DB ---
export type User = Database['public']['Tables']['users']['Row']
export type Channel = Database['public']['Tables']['channels']['Row']
export type Video = Database['public']['Tables']['videos']['Row']
export type VideoAnalysis = Database['public']['Tables']['video_analysis']['Row']
export type VideoLocalizedContent = Database['public']['Tables']['video_localized_content']['Row']
export type UserChannel = Database['public']['Tables']['user_channels']['Row']
export type UserVideoState = Database['public']['Tables']['user_video_states']['Row']
export type WatchlistItem = Database['public']['Tables']['watchlist_items']['Row']
export type Job = Database['public']['Tables']['jobs']['Row']
export type AllowlistEntry = Database['public']['Tables']['allowlist_entries']['Row']
export type UserProviderCredential = Database['public']['Tables']['user_provider_credentials']['Row']
export type AppLog = Database['public']['Tables']['app_logs']['Row']
export type AuditLog = Database['public']['Tables']['audit_logs']['Row']
export type Incident = Database['public']['Tables']['incidents']['Row']

// --- Domain types (enriched / composed) ---

/**
 * Video with its AI analysis content (localized), user state, and channel info.
 * This is the primary type used in the UI.
 */
export interface VideoWithContext {
  video: Video
  channel: Channel
  analysis: VideoAnalysis | null
  localizedContent: VideoLocalizedContent | null
  userState: VideoUserState
}

/** User-specific video state (derived from sparse user_video_states + watchlist_items) */
export interface VideoUserState {
  seenStatus: 'seen' | 'unseen' | 'hidden'
  isInWatchlist: boolean
  seenAt: string | null
  hiddenAt: string | null
}

/**
 * Channel with user-specific context (is followed, preferences, status).
 */
export interface ChannelWithUserContext {
  channel: Channel
  userChannel: UserChannel | null
  preferences: Database['public']['Tables']['user_channel_preferences']['Row'] | null
  syncState: Database['public']['Tables']['canonical_sync_state']['Row'] | null
  hasValidApiKeys: boolean
  latestVideoId: string | null
}

/** API credential status for a provider */
export interface CredentialStatus {
  provider: 'youtube' | 'gemini'
  isConfigured: boolean
  isValid: boolean | null
  lastValidatedAt: string | null
  lastUsedAt: string | null
  lastError: string | null
  maskedKey: string | null // e.g., "••••••1234"
}

/** Authenticated user session with role info */
export interface AuthSession {
  userId: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  role: 'user' | 'super_admin'
  preferredLanguage: string
}

/** Result of channel URL parsing */
export interface ParsedYouTubeUrl {
  type: 'handle' | 'channel_id' | 'invalid'
  value: string // the handle or channel ID
  originalUrl: string
}

/** Job types supported in V1 */
export type JobType =
  | 'analyze_latest_video_on_channel_add'
  | 'sync_channel_delta'
  | 'analyze_single_historical_video'
  | 'hydrate_existing_canonical_content'
  | 'validate_user_credentials'
  | 'admin_retry_failed_job'

/** Error types for classification */
export type AppErrorType =
  | 'temporary' // network, timeout, transient — retryable
  | 'structural' // invalid key, quota, permission — requires intervention
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'unknown'

/** Standardized API response wrapper */
export interface ApiResponse<T = void> {
  data: T | null
  error: string | null
  errorType: AppErrorType | null
}
