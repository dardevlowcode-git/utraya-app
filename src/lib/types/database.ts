/* Commento didattico:
 * Scopo del file: dichiara tipi TypeScript condivisi, utili per rendere il codice piu` sicuro e leggibile.
 * Moduli richiamati: nessun import esterno: il file usa logica locale o sole primitive del linguaggio.
 * Flusso: I tipi dichiarati qui sono importati da servizi, API e componenti per controllare forma e coerenza dei dati.
 */

/**
 * Database types generated from the Utraya schema.
 *
 * In production, generate this file using:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/lib/types/database.ts
 *
 * For now, this file provides a baseline type structure matching the V1 schema.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      // --- Identity & Access ---
      users: {
        Row: {
          id: string
          email: string
          display_name: string | null
          avatar_url: string | null
          preferred_language: string
          status: 'active' | 'suspended' | 'deleted'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          display_name?: string | null
          avatar_url?: string | null
          preferred_language?: string
          status?: 'active' | 'suspended' | 'deleted'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          display_name?: string | null
          avatar_url?: string | null
          preferred_language?: string
          status?: 'active' | 'suspended' | 'deleted'
          updated_at?: string
        }
        Relationships: []
      }
      user_identities: {
        Row: {
          id: string
          user_id: string
          provider: string
          provider_user_id: string
          email: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          provider_user_id: string
          email: string
          created_at?: string
        }
        Update: {
          email?: string
        }
        Relationships: []
      }
      roles: {
        Row: {
          id: string
          name: 'user' | 'super_admin'
        }
        Insert: {
          id?: string
          name: 'user' | 'super_admin'
        }
        Update: {
          name?: 'user' | 'super_admin'
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          user_id: string
          role_id: string
          assigned_at: string
          assigned_by: string | null
        }
        Insert: {
          user_id: string
          role_id: string
          assigned_at?: string
          assigned_by?: string | null
        }
        Update: Record<string, never>
        Relationships: []
      }
      allowlist_entries: {
        Row: {
          id: string
          email: string
          added_by: string | null
          added_at: string
          is_active: boolean
        }
        Insert: {
          id?: string
          email: string
          added_by?: string | null
          added_at?: string
          is_active?: boolean
        }
        Update: {
          is_active?: boolean
        }
        Relationships: []
      }
      admin_actions_audit: {
        Row: {
          id: string
          admin_user_id: string
          action_type: string
          target_type: string
          target_id: string | null
          details: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          admin_user_id: string
          action_type: string
          target_type: string
          target_id?: string | null
          details?: Json | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      // --- User API Credentials ---
      user_provider_credentials: {
        Row: {
          id: string
          user_id: string
          provider: 'youtube' | 'gemini'
          encrypted_key: string | null
          is_configured: boolean
          is_valid: boolean | null
          last_validated_at: string | null
          last_used_at: string | null
          last_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: 'youtube' | 'gemini'
          encrypted_key?: string | null
          is_configured?: boolean
          is_valid?: boolean | null
          last_validated_at?: string | null
          last_used_at?: string | null
          last_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          encrypted_key?: string | null
          is_configured?: boolean
          is_valid?: boolean | null
          last_validated_at?: string | null
          last_used_at?: string | null
          last_error?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      credential_checks: {
        Row: {
          id: string
          credential_id: string
          checked_at: string
          is_valid: boolean
          error_message: string | null
          error_type: 'temporary' | 'structural' | null
        }
        Insert: {
          id?: string
          credential_id: string
          checked_at?: string
          is_valid: boolean
          error_message?: string | null
          error_type?: 'temporary' | 'structural' | null
        }
        Update: Record<string, never>
        Relationships: []
      }
      // --- Canonical Layer ---
      channels: {
        Row: {
          id: string
          youtube_channel_id: string
          handle: string | null
          title: string
          description: string | null
          thumbnail_url: string | null
          subscriber_count: number | null
          video_count: number | null
          custom_url: string | null
          youtube_metadata: Json | null
          status: 'active' | 'inactive' | 'error'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          youtube_channel_id: string
          handle?: string | null
          title: string
          description?: string | null
          thumbnail_url?: string | null
          subscriber_count?: number | null
          video_count?: number | null
          custom_url?: string | null
          youtube_metadata?: Json | null
          status?: 'active' | 'inactive' | 'error'
          created_at?: string
          updated_at?: string
        }
        Update: {
          handle?: string | null
          title?: string
          description?: string | null
          thumbnail_url?: string | null
          subscriber_count?: number | null
          video_count?: number | null
          custom_url?: string | null
          youtube_metadata?: Json | null
          status?: 'active' | 'inactive' | 'error'
          updated_at?: string
        }
        Relationships: []
      }
      videos: {
        Row: {
          id: string
          channel_id: string
          youtube_video_id: string
          title: string
          description: string | null
          thumbnail_url: string | null
          published_at: string
          duration_seconds: number | null
          video_url: string
          video_type: 'standard' | 'live_replay' | 'premiere'
          availability_status: 'available' | 'unavailable' | 'private'
          youtube_metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          channel_id: string
          youtube_video_id: string
          title: string
          description?: string | null
          thumbnail_url?: string | null
          published_at: string
          duration_seconds?: number | null
          video_url: string
          video_type?: 'standard' | 'live_replay' | 'premiere'
          availability_status?: 'available' | 'unavailable' | 'private'
          youtube_metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          thumbnail_url?: string | null
          availability_status?: 'available' | 'unavailable' | 'private'
          youtube_metadata?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      video_analysis: {
        Row: {
          id: string
          video_id: string
          analysis_status: 'pending' | 'processing' | 'completed' | 'failed'
          model_used: string | null
          prompt_profile_id: string | null
          analyzed_at: string | null
          analyzed_by_user_id: string | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          video_id: string
          analysis_status?: 'pending' | 'processing' | 'completed' | 'failed'
          model_used?: string | null
          prompt_profile_id?: string | null
          analyzed_at?: string | null
          analyzed_by_user_id?: string | null
          error_message?: string | null
          created_at?: string
        }
        Update: {
          analysis_status?: 'pending' | 'processing' | 'completed' | 'failed'
          model_used?: string | null
          analyzed_at?: string | null
          error_message?: string | null
        }
        Relationships: []
      }
      video_analysis_raw: {
        Row: {
          id: string
          video_analysis_id: string
          provider: string
          raw_request: Json | null
          raw_response: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          video_analysis_id: string
          provider: string
          raw_request?: Json | null
          raw_response?: Json | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      video_localized_content: {
        Row: {
          id: string
          video_analysis_id: string
          video_id: string
          language_code: string
          short_summary: string | null
          full_summary: string | null
          general_category: string | null
          subcategory: string | null
          highlights_text: string | null
          is_admin_edited: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          video_analysis_id: string
          video_id: string
          language_code: string
          short_summary?: string | null
          full_summary?: string | null
          general_category?: string | null
          subcategory?: string | null
          highlights_text?: string | null
          is_admin_edited?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          short_summary?: string | null
          full_summary?: string | null
          general_category?: string | null
          subcategory?: string | null
          highlights_text?: string | null
          is_admin_edited?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      canonical_sync_state: {
        Row: {
          id: string
          channel_id: string
          last_sync_at: string | null
          last_sync_status: 'success' | 'failed' | 'partial' | null
          next_sync_at: string | null
          videos_found_count: number | null
        }
        Insert: {
          id?: string
          channel_id: string
          last_sync_at?: string | null
          last_sync_status?: 'success' | 'failed' | 'partial' | null
          next_sync_at?: string | null
          videos_found_count?: number | null
        }
        Update: {
          last_sync_at?: string | null
          last_sync_status?: 'success' | 'failed' | 'partial' | null
          next_sync_at?: string | null
          videos_found_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'canonical_sync_state_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: true
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
        ]
      }
      // --- User Layer ---
      user_channels: {
        Row: {
          id: string
          user_id: string
          channel_id: string
          is_active: boolean
          added_at: string
          removed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          channel_id: string
          is_active?: boolean
          added_at?: string
          removed_at?: string | null
        }
        Update: {
          is_active?: boolean
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'user_channels_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
        ]
      }
      user_channel_preferences: {
        Row: {
          id: string
          user_channel_id: string
          sync_frequency_hours: number
          is_paused: boolean
        }
        Insert: {
          id?: string
          user_channel_id: string
          sync_frequency_hours?: number
          is_paused?: boolean
        }
        Update: {
          sync_frequency_hours?: number
          is_paused?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'user_channel_preferences_user_channel_id_fkey'
            columns: ['user_channel_id']
            isOneToOne: false
            referencedRelation: 'user_channels'
            referencedColumns: ['id']
          },
        ]
      }
      user_video_states: {
        Row: {
          id: string
          user_id: string
          video_id: string
          seen_status: 'unseen' | 'seen' | 'hidden'
          seen_at: string | null
          hidden_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          video_id: string
          seen_status?: 'unseen' | 'seen' | 'hidden'
          seen_at?: string | null
          hidden_at?: string | null
        }
        Update: {
          seen_status?: 'unseen' | 'seen' | 'hidden'
          seen_at?: string | null
          hidden_at?: string | null
        }
        Relationships: []
      }
      watchlists: {
        Row: {
          id: string
          user_id: string
          name: string
          is_default: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          is_default?: boolean
          created_at?: string
        }
        Update: {
          name?: string
          is_default?: boolean
        }
        Relationships: []
      }
      watchlist_items: {
        Row: {
          id: string
          watchlist_id: string
          video_id: string
          added_at: string
        }
        Insert: {
          id?: string
          watchlist_id: string
          video_id: string
          added_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      // --- Jobs & Operations ---
      jobs: {
        Row: {
          id: string
          job_type: string
          status: 'pending' | 'running' | 'completed' | 'failed'
          priority: number
          payload: Json | null
          deduplication_key: string | null
          created_by_user_id: string | null
          created_at: string
          started_at: string | null
          completed_at: string | null
          error_message: string | null
          lease_id: string | null
          lease_expires_at: string | null
        }
        Insert: {
          id?: string
          job_type: string
          status?: 'pending' | 'running' | 'completed' | 'failed'
          priority?: number
          payload?: Json | null
          deduplication_key?: string | null
          created_by_user_id?: string | null
          created_at?: string
          started_at?: string | null
          completed_at?: string | null
          error_message?: string | null
          lease_id?: string | null
          lease_expires_at?: string | null
        }
        Update: {
          status?: 'pending' | 'running' | 'completed' | 'failed'
          started_at?: string | null
          completed_at?: string | null
          error_message?: string | null
          lease_id?: string | null
          lease_expires_at?: string | null
        }
        Relationships: []
      }
      api_verifier_oidc_nonces: {
        Row: { jti: string; expires_at: string; created_at: string }
        Insert: { jti: string; expires_at: string; created_at?: string }
        Update: { expires_at?: string }
        Relationships: []
      }
      job_attempts: {
        Row: {
          id: string
          job_id: string
          attempt_number: number
          status: 'running' | 'completed' | 'failed'
          started_at: string
          completed_at: string | null
          error_message: string | null
          error_details: Json | null
        }
        Insert: {
          id?: string
          job_id: string
          attempt_number: number
          status: 'running' | 'completed' | 'failed'
          started_at?: string
          completed_at?: string | null
          error_message?: string | null
          error_details?: Json | null
        }
        Update: {
          status?: 'running' | 'completed' | 'failed'
          completed_at?: string | null
          error_message?: string | null
          error_details?: Json | null
        }
        Relationships: []
      }
      job_locks: {
        Row: {
          id: string
          lock_key: string
          locked_by: string
          locked_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          lock_key: string
          locked_by: string
          locked_at?: string
          expires_at: string
        }
        Update: {
          expires_at?: string
        }
        Relationships: []
      }
      app_logs: {
        Row: {
          id: string
          level: 'info' | 'warn' | 'error' | 'debug'
          message: string
          context: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          level: 'info' | 'warn' | 'error' | 'debug'
          message: string
          context?: Json | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          user_id: string | null
          action: string
          resource_type: string
          resource_id: string | null
          details: Json | null
          ip_address: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          resource_type: string
          resource_id?: string | null
          details?: Json | null
          ip_address?: string | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      incidents: {
        Row: {
          id: string
          severity: 'low' | 'medium' | 'high' | 'critical'
          title: string
          description: string | null
          related_job_id: string | null
          status: 'open' | 'investigating' | 'resolved'
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          severity: 'low' | 'medium' | 'high' | 'critical'
          title: string
          description?: string | null
          related_job_id?: string | null
          status?: 'open' | 'investigating' | 'resolved'
          created_at?: string
          resolved_at?: string | null
        }
        Update: {
          status?: 'open' | 'investigating' | 'resolved'
          resolved_at?: string | null
        }
        Relationships: []
      }
      user_deletion_requests: {
        Row: {
          id: string
          user_id: string | null
          requested_at: string
          scheduled_deletion_at: string
          status: 'pending' | 'cancelled' | 'executing' | 'completed' | 'failed'
          reason: string | null
          ip_address: string | null
          user_agent: string | null
          cancelled_at: string | null
          executed_at: string | null
          error_details: string | null
          previous_user_status: 'active' | 'suspended' | 'deleted'
          suspension_updated_at: string | null
          executing_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          requested_at?: string
          scheduled_deletion_at: string
          status?: 'pending' | 'cancelled' | 'executing' | 'completed' | 'failed'
          reason?: string | null
          ip_address?: string | null
          user_agent?: string | null
          cancelled_at?: string | null
          executed_at?: string | null
          error_details?: string | null
          previous_user_status?: 'active' | 'suspended' | 'deleted'
          suspension_updated_at?: string | null
          executing_at?: string | null
        }
        Update: {
          status?: 'pending' | 'cancelled' | 'executing' | 'completed' | 'failed'
          cancelled_at?: string | null
          executed_at?: string | null
          error_details?: string | null
          previous_user_status?: 'active' | 'suspended' | 'deleted'
          suspension_updated_at?: string | null
          executing_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      is_current_user_allowlisted: {
        Args: Record<string, never>
        Returns: boolean
      }
      claim_account_deletion: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      request_account_deletion: {
        Args: {
          p_user_id: string
          p_reason: string | null
          p_ip_address: string | null
          p_user_agent: string | null
          p_scheduled_at: string
        }
        Returns: { request_id: string; scheduled_for: string }[]
      }
      cancel_account_deletion: {
        Args: { p_user_id: string; p_request_id: string }
        Returns: boolean
      }
      execute_user_deletion: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      commit_fenced_channel_import: {
        Args: {
          p_job_id: string
          p_lease_id: string
          p_user_id: string
          p_requested_channel_id: string
          p_resolved_youtube_channel_id: string | null
          p_resolved_channel_title: string | null
          p_resolved_channel_handle: string | null
          p_channel_snapshot: Json
          p_video_rows: Json
          p_sync_status: 'success' | 'partial'
          p_videos_found_count: number
        }
        Returns: Json
      }
    }
    Enums: Record<string, never>
  }
}
