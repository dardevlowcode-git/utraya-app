
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_actions_audit": {
                  Row: {
                    "action_type": string,"admin_user_id": string,"created_at": string,"details": Json | null,"id": string,"target_id": string | null,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action_type": string,"admin_user_id": string,"created_at"?: string,"details"?: Json | null,"id"?: string,"target_id"?: string | null,"target_type": string
                  }
                  Update: {
                    "action_type"?: string,"admin_user_id"?: string,"created_at"?: string,"details"?: Json | null,"id"?: string,"target_id"?: string | null,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_actions_audit_admin_user_id_fkey"
      columns: ["admin_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"allowlist_entries": {
                  Row: {
                    "added_at": string,"added_by": string | null,"email": string,"id": string,"is_active": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"email": string,"id"?: string,"is_active"?: boolean
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"email"?: string,"id"?: string,"is_active"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "allowlist_entries_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"api_usage_events": {
                  Row: {
                    "error_category": string | null,"estimated_cost_usd": number | null,"http_status": number | null,"id": string,"input_rate_usd_per_million": number | null,"input_tokens": number | null,"model": string | null,"occurred_at": string,"operation": string,"outcome": string,"output_rate_usd_per_million": number | null,"output_tokens": number | null,"provider": string,"quota_bucket": string | null,"quota_units": number | null,"total_tokens": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "error_category"?: string | null,"estimated_cost_usd"?: number | null,"http_status"?: number | null,"id"?: string,"input_rate_usd_per_million"?: number | null,"input_tokens"?: number | null,"model"?: string | null,"occurred_at"?: string,"operation": string,"outcome": string,"output_rate_usd_per_million"?: number | null,"output_tokens"?: number | null,"provider": string,"quota_bucket"?: string | null,"quota_units"?: number | null,"total_tokens"?: number | null,"user_id": string
                  }
                  Update: {
                    "error_category"?: string | null,"estimated_cost_usd"?: number | null,"http_status"?: number | null,"id"?: string,"input_rate_usd_per_million"?: number | null,"input_tokens"?: number | null,"model"?: string | null,"occurred_at"?: string,"operation"?: string,"outcome"?: string,"output_rate_usd_per_million"?: number | null,"output_tokens"?: number | null,"provider"?: string,"quota_bucket"?: string | null,"quota_units"?: number | null,"total_tokens"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_usage_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"api_verifier_oidc_nonces": {
                  Row: {
                    "created_at": string,"expires_at": string,"jti": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"jti": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"jti"?: string
                  }
                  Relationships: [
                    
                  ]
                },"app_logs": {
                  Row: {
                    "context": Json | null,"created_at": string,"id": string,"level": string,"message": string
                  }
                  ComputedFields: never
                  Insert: {
                    "context"?: Json | null,"created_at"?: string,"id"?: string,"level": string,"message": string
                  }
                  Update: {
                    "context"?: Json | null,"created_at"?: string,"id"?: string,"level"?: string,"message"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"created_at": string,"details": Json | null,"id": string,"ip_address": string | null,"resource_id": string | null,"resource_type": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string,"details"?: Json | null,"id"?: string,"ip_address"?: string | null,"resource_id"?: string | null,"resource_type": string,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"details"?: Json | null,"id"?: string,"ip_address"?: string | null,"resource_id"?: string | null,"resource_type"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"canonical_sync_state": {
                  Row: {
                    "channel_id": string,"id": string,"last_sync_at": string | null,"last_sync_status": string | null,"next_sync_at": string | null,"videos_found_count": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"id"?: string,"last_sync_at"?: string | null,"last_sync_status"?: string | null,"next_sync_at"?: string | null,"videos_found_count"?: number | null
                  }
                  Update: {
                    "channel_id"?: string,"id"?: string,"last_sync_at"?: string | null,"last_sync_status"?: string | null,"next_sync_at"?: string | null,"videos_found_count"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "canonical_sync_state_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: true
      referencedRelation: "channels"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_scan_job_credentials": {
                  Row: {
                    "assigned_at": string,"credential_id": string,"job_id": string,"key_version": string,"provider": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"credential_id": string,"job_id": string,"key_version": string,"provider"?: string,"status": string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_at"?: string,"credential_id"?: string,"job_id"?: string,"key_version"?: string,"provider"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_scan_job_credentials_credential_id_fkey"
      columns: ["credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_scan_job_credentials_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_scan_key_rotation_cursors": {
                  Row: {
                    "channel_id": string,"last_credential_id": string | null,"provider": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"last_credential_id"?: string | null,"provider": string,"updated_at"?: string
                  }
                  Update: {
                    "channel_id"?: string,"last_credential_id"?: string | null,"provider"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_scan_key_rotation_cursors_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_scan_key_rotation_cursors_last_credential_id_fkey"
      columns: ["last_credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_scan_provider_attempts": {
                  Row: {
                    "attempts_used": number,"credential_id": string,"job_id": string,"key_version": string,"last_outcome": string,"request_key": string,"retry_at": string | null,"retry_limit": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts_used"?: number,"credential_id": string,"job_id": string,"key_version": string,"last_outcome": string,"request_key": string,"retry_at"?: string | null,"retry_limit": number,"updated_at"?: string
                  }
                  Update: {
                    "attempts_used"?: number,"credential_id"?: string,"job_id"?: string,"key_version"?: string,"last_outcome"?: string,"request_key"?: string,"retry_at"?: string | null,"retry_limit"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_scan_provider_attempts_credential_id_fkey"
      columns: ["credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_scan_provider_attempts_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_scan_provider_attempts_job_id_request_key_fkey"
      columns: ["job_id","request_key"]
isOneToOne: false
      referencedRelation: "channel_scan_provider_requests"
      referencedColumns: ["job_id","request_key"]
    }
                  ]
                },"channel_scan_provider_requests": {
                  Row: {
                    "created_at": string,"credential_id": string | null,"job_id": string,"provider": string,"request_key": string,"response": Json | null,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"credential_id"?: string | null,"job_id": string,"provider"?: string,"request_key": string,"response"?: Json | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"credential_id"?: string | null,"job_id"?: string,"provider"?: string,"request_key"?: string,"response"?: Json | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_scan_provider_requests_credential_id_fkey"
      columns: ["credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_scan_provider_requests_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_scan_provider_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"channels": {
                  Row: {
                    "created_at": string,"custom_url": string | null,"description": string | null,"handle": string | null,"id": string,"status": string,"subscriber_count": number | null,"thumbnail_url": string | null,"title": string,"updated_at": string,"video_count": number | null,"youtube_channel_id": string,"youtube_metadata": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"custom_url"?: string | null,"description"?: string | null,"handle"?: string | null,"id"?: string,"status"?: string,"subscriber_count"?: number | null,"thumbnail_url"?: string | null,"title": string,"updated_at"?: string,"video_count"?: number | null,"youtube_channel_id": string,"youtube_metadata"?: Json | null
                  }
                  Update: {
                    "created_at"?: string,"custom_url"?: string | null,"description"?: string | null,"handle"?: string | null,"id"?: string,"status"?: string,"subscriber_count"?: number | null,"thumbnail_url"?: string | null,"title"?: string,"updated_at"?: string,"video_count"?: number | null,"youtube_channel_id"?: string,"youtube_metadata"?: Json | null
                  }
                  Relationships: [
                    
                  ]
                },"credential_checks": {
                  Row: {
                    "checked_at": string,"credential_id": string,"error_message": string | null,"error_type": string | null,"id": string,"is_valid": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_at"?: string,"credential_id": string,"error_message"?: string | null,"error_type"?: string | null,"id"?: string,"is_valid": boolean
                  }
                  Update: {
                    "checked_at"?: string,"credential_id"?: string,"error_message"?: string | null,"error_type"?: string | null,"id"?: string,"is_valid"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "credential_checks_credential_id_fkey"
      columns: ["credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    }
                  ]
                },"cron_settings": {
                  Row: {
                    "batch_limit": number,"enabled": boolean,"schedule_key": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_limit"?: number,"enabled"?: boolean,"schedule_key": string,"updated_at"?: string
                  }
                  Update: {
                    "batch_limit"?: number,"enabled"?: boolean,"schedule_key"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"incidents": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"related_job_id": string | null,"resolved_at": string | null,"severity": string,"status": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"related_job_id"?: string | null,"resolved_at"?: string | null,"severity": string,"status"?: string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"related_job_id"?: string | null,"resolved_at"?: string | null,"severity"?: string,"status"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "incidents_related_job_id_fkey"
      columns: ["related_job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"job_attempts": {
                  Row: {
                    "attempt_number": number,"completed_at": string | null,"error_details": Json | null,"error_message": string | null,"id": string,"job_id": string,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_number": number,"completed_at"?: string | null,"error_details"?: Json | null,"error_message"?: string | null,"id"?: string,"job_id": string,"started_at"?: string,"status": string
                  }
                  Update: {
                    "attempt_number"?: number,"completed_at"?: string | null,"error_details"?: Json | null,"error_message"?: string | null,"id"?: string,"job_id"?: string,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_attempts_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"job_locks": {
                  Row: {
                    "expires_at": string,"id": string,"lock_key": string,"locked_at": string,"locked_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "expires_at": string,"id"?: string,"lock_key": string,"locked_at"?: string,"locked_by": string
                  }
                  Update: {
                    "expires_at"?: string,"id"?: string,"lock_key"?: string,"locked_at"?: string,"locked_by"?: string
                  }
                  Relationships: [
                    
                  ]
                },"jobs": {
                  Row: {
                    "available_at": string | null,"completed_at": string | null,"created_at": string,"created_by_user_id": string | null,"deduplication_key": string | null,"error_message": string | null,"id": string,"job_type": string,"lease_expires_at": string | null,"lease_id": string | null,"next_attempt_at": string | null,"payload": Json | null,"priority": number,"started_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "available_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by_user_id"?: string | null,"deduplication_key"?: string | null,"error_message"?: string | null,"id"?: string,"job_type": string,"lease_expires_at"?: string | null,"lease_id"?: string | null,"next_attempt_at"?: string | null,"payload"?: Json | null,"priority"?: number,"started_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "available_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by_user_id"?: string | null,"deduplication_key"?: string | null,"error_message"?: string | null,"id"?: string,"job_type"?: string,"lease_expires_at"?: string | null,"lease_id"?: string | null,"next_attempt_at"?: string | null,"payload"?: Json | null,"priority"?: number,"started_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_created_by_user_id_fkey"
      columns: ["created_by_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"legal_acceptances": {
                  Row: {
                    "accepted_at": string,"created_at": string,"document_hash": string,"document_kind": string,"document_version": string,"id": string,"ip_address": unknown,"locale": string,"user_agent": string | null,"user_email_at_acceptance": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string,"created_at"?: string,"document_hash": string,"document_kind": string,"document_version": string,"id"?: string,"ip_address"?: unknown,"locale": string,"user_agent"?: string | null,"user_email_at_acceptance": string,"user_id"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string,"created_at"?: string,"document_hash"?: string,"document_kind"?: string,"document_version"?: string,"id"?: string,"ip_address"?: unknown,"locale"?: string,"user_agent"?: string | null,"user_email_at_acceptance"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"roles": {
                  Row: {
                    "id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string
                  }
                  Update: {
                    "id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"shared_provider_retry_settings": {
                  Row: {
                    "provider_key": string,"retry_limit": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "provider_key": string,"retry_limit"?: number,"updated_at"?: string
                  }
                  Update: {
                    "provider_key"?: string,"retry_limit"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"transcription_job_credentials": {
                  Row: {
                    "assigned_at": string,"credential_id": string,"job_id": string,"key_version": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"credential_id": string,"job_id": string,"key_version": string,"status": string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_at"?: string,"credential_id"?: string,"job_id"?: string,"key_version"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcription_job_credentials_credential_id_fkey"
      columns: ["credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transcription_job_credentials_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"transcription_key_rotation_cursors": {
                  Row: {
                    "channel_id": string,"last_credential_id": string | null,"provider": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"last_credential_id"?: string | null,"provider": string,"updated_at"?: string
                  }
                  Update: {
                    "channel_id"?: string,"last_credential_id"?: string | null,"provider"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcription_key_rotation_cursors_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transcription_key_rotation_cursors_last_credential_id_fkey"
      columns: ["last_credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    }
                  ]
                },"transcription_part_exhausted_keys": {
                  Row: {
                    "created_at": string,"credential_id": string,"key_version": string,"part_position": number,"transcription_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"credential_id": string,"key_version": string,"part_position": number,"transcription_id": string
                  }
                  Update: {
                    "created_at"?: string,"credential_id"?: string,"key_version"?: string,"part_position"?: number,"transcription_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcription_part_exhausted__transcription_id_part_positi_fkey"
      columns: ["transcription_id","part_position"]
isOneToOne: false
      referencedRelation: "transcription_parts"
      referencedColumns: ["transcription_id","position"]
    },{
      foreignKeyName: "transcription_part_exhausted_keys_credential_id_fkey"
      columns: ["credential_id"]
isOneToOne: false
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    }
                  ]
                },"transcription_parts": {
                  Row: {
                    "attempts": number,"end_seconds": number,"id": string,"last_error": string | null,"position": number,"start_seconds": number,"status": string,"transcription_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"end_seconds": number,"id"?: string,"last_error"?: string | null,"position": number,"start_seconds": number,"status"?: string,"transcription_id": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"end_seconds"?: number,"id"?: string,"last_error"?: string | null,"position"?: number,"start_seconds"?: number,"status"?: string,"transcription_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcription_parts_transcription_id_fkey"
      columns: ["transcription_id"]
isOneToOne: false
      referencedRelation: "transcriptions"
      referencedColumns: ["id"]
    }
                  ]
                },"transcription_phrases": {
                  Row: {
                    "doubtful_time": boolean,"id": string,"position": number,"start_seconds": number,"text": string,"transcription_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "doubtful_time"?: boolean,"id"?: string,"position": number,"start_seconds": number,"text": string,"transcription_id": string
                  }
                  Update: {
                    "doubtful_time"?: boolean,"id"?: string,"position"?: number,"start_seconds"?: number,"text"?: string,"transcription_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcription_phrases_transcription_id_fkey"
      columns: ["transcription_id"]
isOneToOne: false
      referencedRelation: "transcriptions"
      referencedColumns: ["id"]
    }
                  ]
                },"transcription_profile": {
                  Row: {
                    "id": boolean,"input_price_per_million": number,"model": string,"output_price_per_million": number,"thinking_level": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"input_price_per_million"?: number,"model"?: string,"output_price_per_million"?: number,"thinking_level"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: boolean,"input_price_per_million"?: number,"model"?: string,"output_price_per_million"?: number,"thinking_level"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"transcription_profile_audit": {
                  Row: {
                    "admin_username": string,"created_at": string,"id": string,"new_values": NonNullable<Json>,"previous_values": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_username": string,"created_at"?: string,"id"?: string,"new_values": NonNullable<Json>,"previous_values": NonNullable<Json>
                  }
                  Update: {
                    "admin_username"?: string,"created_at"?: string,"id"?: string,"new_values"?: NonNullable<Json>,"previous_values"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"transcription_relaunch_audit": {
                  Row: {
                    "admin_username": string,"created_at": string,"credential_mode": string,"id": string,"job_id": string | null,"part_position": number | null,"parts_reset": number,"transcription_id": string | null,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_username": string,"created_at"?: string,"credential_mode": string,"id"?: string,"job_id"?: string | null,"part_position"?: number | null,"parts_reset": number,"transcription_id"?: string | null,"video_id": string
                  }
                  Update: {
                    "admin_username"?: string,"created_at"?: string,"credential_mode"?: string,"id"?: string,"job_id"?: string | null,"part_position"?: number | null,"parts_reset"?: number,"transcription_id"?: string | null,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcription_relaunch_audit_transcription_id_fkey"
      columns: ["transcription_id"]
isOneToOne: false
      referencedRelation: "transcriptions"
      referencedColumns: ["id"]
    }
                  ]
                },"transcriptions": {
                  Row: {
                    "chunk_seconds": number,"completed_at": string | null,"created_at": string,"doubtful_phrase_count": number,"id": string,"language_code": string | null,"missing_part_count": number,"model": string,"requested_by_user_id": string | null,"status": string,"thinking_level": string,"updated_at": string,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chunk_seconds"?: number,"completed_at"?: string | null,"created_at"?: string,"doubtful_phrase_count"?: number,"id"?: string,"language_code"?: string | null,"missing_part_count"?: number,"model": string,"requested_by_user_id"?: string | null,"status"?: string,"thinking_level": string,"updated_at"?: string,"video_id": string
                  }
                  Update: {
                    "chunk_seconds"?: number,"completed_at"?: string | null,"created_at"?: string,"doubtful_phrase_count"?: number,"id"?: string,"language_code"?: string | null,"missing_part_count"?: number,"model"?: string,"requested_by_user_id"?: string | null,"status"?: string,"thinking_level"?: string,"updated_at"?: string,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcriptions_requested_by_user_id_fkey"
      columns: ["requested_by_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transcriptions_video_id_fkey"
      columns: ["video_id"]
isOneToOne: true
      referencedRelation: "videos"
      referencedColumns: ["id"]
    }
                  ]
                },"user_channel_preferences": {
                  Row: {
                    "id": string,"is_paused": boolean,"sync_frequency_hours": number,"user_channel_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"is_paused"?: boolean,"sync_frequency_hours"?: number,"user_channel_id": string
                  }
                  Update: {
                    "id"?: string,"is_paused"?: boolean,"sync_frequency_hours"?: number,"user_channel_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_channel_preferences_user_channel_id_fkey"
      columns: ["user_channel_id"]
isOneToOne: true
      referencedRelation: "user_channels"
      referencedColumns: ["id"]
    }
                  ]
                },"user_channels": {
                  Row: {
                    "added_at": string,"channel_id": string,"id": string,"is_active": boolean,"removed_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"channel_id": string,"id"?: string,"is_active"?: boolean,"removed_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"channel_id"?: string,"id"?: string,"is_active"?: boolean,"removed_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_channels_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_channels_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_deletion_requests": {
                  Row: {
                    "cancelled_at": string | null,"error_details": string | null,"executed_at": string | null,"executing_at": string | null,"id": string,"ip_address": unknown,"previous_user_status": string,"reason": string | null,"requested_at": string,"scheduled_deletion_at": string,"status": string,"suspension_updated_at": string | null,"user_agent": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"error_details"?: string | null,"executed_at"?: string | null,"executing_at"?: string | null,"id"?: string,"ip_address"?: unknown,"previous_user_status"?: string,"reason"?: string | null,"requested_at"?: string,"scheduled_deletion_at": string,"status"?: string,"suspension_updated_at"?: string | null,"user_agent"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "cancelled_at"?: string | null,"error_details"?: string | null,"executed_at"?: string | null,"executing_at"?: string | null,"id"?: string,"ip_address"?: unknown,"previous_user_status"?: string,"reason"?: string | null,"requested_at"?: string,"scheduled_deletion_at"?: string,"status"?: string,"suspension_updated_at"?: string | null,"user_agent"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_deletion_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_identities": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"provider": string,"provider_user_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id"?: string,"provider": string,"provider_user_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"provider"?: string,"provider_user_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_identities_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_provider_credential_retry_limits": {
                  Row: {
                    "credential_id": string,"key_version": string,"retry_limit": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "credential_id": string,"key_version"?: string,"retry_limit"?: number,"updated_at"?: string
                  }
                  Update: {
                    "credential_id"?: string,"key_version"?: string,"retry_limit"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_provider_credential_retry_limits_credential_id_fkey"
      columns: ["credential_id"]
isOneToOne: true
      referencedRelation: "user_provider_credentials"
      referencedColumns: ["id"]
    }
                  ]
                },"user_provider_credentials": {
                  Row: {
                    "created_at": string,"encrypted_key": string | null,"id": string,"is_configured": boolean,"is_valid": boolean | null,"last_error": string | null,"last_used_at": string | null,"last_validated_at": string | null,"provider": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"encrypted_key"?: string | null,"id"?: string,"is_configured"?: boolean,"is_valid"?: boolean | null,"last_error"?: string | null,"last_used_at"?: string | null,"last_validated_at"?: string | null,"provider": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"encrypted_key"?: string | null,"id"?: string,"is_configured"?: boolean,"is_valid"?: boolean | null,"last_error"?: string | null,"last_used_at"?: string | null,"last_validated_at"?: string | null,"provider"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_provider_credentials_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_roles": {
                  Row: {
                    "assigned_at": string,"assigned_by": string | null,"role_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"role_id": string,"user_id": string
                  }
                  Update: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"role_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_roles_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_roles_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_roles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_video_states": {
                  Row: {
                    "hidden_at": string | null,"id": string,"seen_at": string | null,"seen_status": string,"user_id": string,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hidden_at"?: string | null,"id"?: string,"seen_at"?: string | null,"seen_status"?: string,"user_id": string,"video_id": string
                  }
                  Update: {
                    "hidden_at"?: string | null,"id"?: string,"seen_at"?: string | null,"seen_status"?: string,"user_id"?: string,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_video_states_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_video_states_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id"]
    }
                  ]
                },"users": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"email": string,"id": string,"preferred_language": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"email": string,"id": string,"preferred_language"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"email"?: string,"id"?: string,"preferred_language"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"video_analysis": {
                  Row: {
                    "analysis_status": string,"analyzed_at": string | null,"analyzed_by_user_id": string | null,"created_at": string,"error_message": string | null,"id": string,"model_used": string | null,"prompt_profile_id": string | null,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "analysis_status"?: string,"analyzed_at"?: string | null,"analyzed_by_user_id"?: string | null,"created_at"?: string,"error_message"?: string | null,"id"?: string,"model_used"?: string | null,"prompt_profile_id"?: string | null,"video_id": string
                  }
                  Update: {
                    "analysis_status"?: string,"analyzed_at"?: string | null,"analyzed_by_user_id"?: string | null,"created_at"?: string,"error_message"?: string | null,"id"?: string,"model_used"?: string | null,"prompt_profile_id"?: string | null,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_analysis_analyzed_by_user_id_fkey"
      columns: ["analyzed_by_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "video_analysis_video_id_fkey"
      columns: ["video_id"]
isOneToOne: true
      referencedRelation: "videos"
      referencedColumns: ["id"]
    }
                  ]
                },"video_analysis_raw": {
                  Row: {
                    "created_at": string,"id": string,"provider": string,"raw_request": Json | null,"raw_response": Json | null,"video_analysis_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"provider": string,"raw_request"?: Json | null,"raw_response"?: Json | null,"video_analysis_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"provider"?: string,"raw_request"?: Json | null,"raw_response"?: Json | null,"video_analysis_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_analysis_raw_video_analysis_id_fkey"
      columns: ["video_analysis_id"]
isOneToOne: false
      referencedRelation: "video_analysis"
      referencedColumns: ["id"]
    }
                  ]
                },"video_localized_content": {
                  Row: {
                    "created_at": string,"full_summary": string | null,"general_category": string | null,"highlights_text": string | null,"id": string,"is_admin_edited": boolean,"language_code": string,"short_summary": string | null,"subcategory": string | null,"updated_at": string,"video_analysis_id": string,"video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_summary"?: string | null,"general_category"?: string | null,"highlights_text"?: string | null,"id"?: string,"is_admin_edited"?: boolean,"language_code": string,"short_summary"?: string | null,"subcategory"?: string | null,"updated_at"?: string,"video_analysis_id": string,"video_id": string
                  }
                  Update: {
                    "created_at"?: string,"full_summary"?: string | null,"general_category"?: string | null,"highlights_text"?: string | null,"id"?: string,"is_admin_edited"?: boolean,"language_code"?: string,"short_summary"?: string | null,"subcategory"?: string | null,"updated_at"?: string,"video_analysis_id"?: string,"video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "video_localized_content_video_analysis_id_fkey"
      columns: ["video_analysis_id"]
isOneToOne: false
      referencedRelation: "video_analysis"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "video_localized_content_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id"]
    }
                  ]
                },"videos": {
                  Row: {
                    "availability_status": string,"channel_id": string,"created_at": string,"description": string | null,"duration_seconds": number | null,"id": string,"published_at": string,"thumbnail_url": string | null,"title": string,"updated_at": string,"video_type": string,"video_url": string,"youtube_metadata": Json | null,"youtube_video_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "availability_status"?: string,"channel_id": string,"created_at"?: string,"description"?: string | null,"duration_seconds"?: number | null,"id"?: string,"published_at": string,"thumbnail_url"?: string | null,"title": string,"updated_at"?: string,"video_type"?: string,"video_url": string,"youtube_metadata"?: Json | null,"youtube_video_id": string
                  }
                  Update: {
                    "availability_status"?: string,"channel_id"?: string,"created_at"?: string,"description"?: string | null,"duration_seconds"?: number | null,"id"?: string,"published_at"?: string,"thumbnail_url"?: string | null,"title"?: string,"updated_at"?: string,"video_type"?: string,"video_url"?: string,"youtube_metadata"?: Json | null,"youtube_video_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "videos_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["id"]
    }
                  ]
                },"watchlist_items": {
                  Row: {
                    "added_at": string,"id": string,"video_id": string,"watchlist_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"id"?: string,"video_id": string,"watchlist_id": string
                  }
                  Update: {
                    "added_at"?: string,"id"?: string,"video_id"?: string,"watchlist_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "watchlist_items_video_id_fkey"
      columns: ["video_id"]
isOneToOne: false
      referencedRelation: "videos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "watchlist_items_watchlist_id_fkey"
      columns: ["watchlist_id"]
isOneToOne: false
      referencedRelation: "watchlists"
      referencedColumns: ["id"]
    }
                  ]
                },"watchlists": {
                  Row: {
                    "created_at": string,"id": string,"is_default": boolean,"name": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_default"?: boolean,"name": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_default"?: boolean,"name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "watchlists_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "cancel_account_deletion":
{ Args: { "p_request_id": string,"p_user_id": string }; Returns: boolean
                           },
"claim_account_deletion":
{ Args: { "p_request_id": string }; Returns: boolean
                           },
"claim_channel_scan_provider_request":
{ Args: { "p_channel_id": string,"p_job_id": string,"p_lease_id": string,"p_request_key": string }; Returns: {
              "attempt_number": number,"credential_id": string,"key_version": string,"response": Json,"retry_at": string,"retry_limit": number,"status": string,"user_id": string
            }[]
                           } |
{ Args: { "p_channel_id": string,"p_job_id": string,"p_lease_id": string,"p_provider": string,"p_request_key": string }; Returns: {
              "attempt_number": number,"credential_id": string,"key_version": string,"response": Json,"retry_at": string,"retry_limit": number,"status": string,"user_id": string
            }[]
                           },
"claim_credential_validation_job_with_attempt":
{ Args: { "p_job_id": string,"p_lease_expires_at": string,"p_lease_id": string,"p_started_at": string }; Returns: {
              "attempt_id": string,"attempt_number": number,"job_id": string,"lease_id": string,"payload": Json
            }[]
                           },
"claim_scan_job_with_attempt":
{ Args: { "p_job_id": string,"p_lease_expires_at": string,"p_lease_id": string,"p_started_at": string }; Returns: {
              "attempt_id": string,"attempt_number": number,"job_id": string,"lease_id": string
            }[]
                           },
"claim_transcription_job_credential":
{ Args: { "p_channel_id": string,"p_job_id": string,"p_lease_id": string }; Returns: {
              "credential_id": string,"key_version": string,"retry_limit": number,"status": string,"user_id": string
            }[]
                           },
"claim_transcription_job_with_attempt":
{ Args: { "p_job_id": string,"p_lease_expires_at": string,"p_lease_id": string,"p_started_at": string }; Returns: {
              "attempt_id": string,"attempt_number": number,"job_id": string,"lease_id": string,"payload": Json
            }[]
                           },
"claim_transcription_part_credential":
{ Args: { "p_channel_id": string,"p_job_id": string,"p_lease_id": string,"p_part_position": number,"p_transcription_id": string }; Returns: {
              "credential_id": string,"key_version": string,"retry_limit": number,"status": string,"user_id": string
            }[]
                           },
"cleanup_old_logs":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"commit_fenced_channel_import":
{ Args: { "p_channel_snapshot": Json,"p_job_id": string,"p_lease_id": string,"p_requested_channel_id": string,"p_resolved_channel_handle": string,"p_resolved_channel_title": string,"p_resolved_youtube_channel_id": string,"p_sync_status": string,"p_user_id": string,"p_video_rows": Json,"p_videos_found_count": number }; Returns: Json
                           },
"defer_scan_job_attempt":
{ Args: { "p_attempt_id": string,"p_available_at": string,"p_completed_at": string,"p_job_id": string,"p_lease_id": string,"p_reason": string }; Returns: boolean
                           },
"enqueue_auto_transcriptions":
{ Args: { "p_channel_id": string,"p_youtube_video_ids": (string)[] }; Returns: number
                           },
"execute_user_deletion":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"finalize_transcription":
{ Args: { "p_close_pending": boolean,"p_job_id": string,"p_lease_id": string,"p_transcription_id": string }; Returns: string
                           },
"finish_channel_scan_provider_attempt":
{ Args: { "p_credential_id": string,"p_job_id": string,"p_key_version": string,"p_lease_id": string,"p_outcome": string,"p_request_key": string,"p_response": Json,"p_retry_at": string }; Returns: boolean
                           },
"finish_credential_validation_job_attempt":
{ Args: { "p_attempt_id": string,"p_attempt_number": number,"p_completed_at": string,"p_credential_changed": boolean,"p_error_message": string,"p_error_type": string,"p_is_valid": boolean,"p_job_id": string,"p_lease_id": string,"p_next_attempt_at": string,"p_retry_limit": number,"p_status": string }; Returns: boolean
                           },
"finish_scan_job_attempt":
{ Args: { "p_attempt_id": string,"p_completed_at": string,"p_error_details": Json,"p_error_message": string,"p_job_id": string,"p_lease_id": string,"p_status": string }; Returns: boolean
                           },
"finish_transcription_job_attempt":
{ Args: { "p_attempt_id": string,"p_completed_at": string,"p_error_details": Json,"p_error_message": string,"p_job_id": string,"p_lease_id": string,"p_status": string }; Returns: boolean
                           },
"get_my_api_usage_summary":
{ Args: { "p_since": string }; Returns: {
              "estimated_cost_usd": number,"input_tokens": number,"output_tokens": number,"provider": string,"quota_units": number,"request_count": number,"total_tokens": number,"unknown_usage_count": number
            }[]
                           },
"has_eligible_transcription_credential":
{ Args: { "p_channel_id": string }; Returns: boolean
                           },
"is_current_user_allowlisted":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_super_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"record_transcription_part_key_exhausted":
{ Args: { "p_credential_id": string,"p_job_id": string,"p_key_version": string,"p_last_error": string,"p_lease_id": string,"p_part_position": number,"p_transcription_id": string }; Returns: boolean
                           },
"relaunch_missing_transcription_parts":
{ Args: { "p_admin_username": string,"p_part_position": number,"p_transcription_id": string }; Returns: {
              "credential_mode": string,"job_id": string,"parts_reset": number,"status": string
            }[]
                           },
"release_transcription_job_credential":
{ Args: { "p_credential_id": string,"p_job_id": string,"p_key_version": string,"p_last_error": string,"p_lease_id": string,"p_part_position": number,"p_status": string,"p_transcription_id": string }; Returns: boolean
                           },
"request_account_deletion":
{ Args: { "p_ip_address": unknown,"p_reason": string,"p_scheduled_at": string,"p_user_agent": string,"p_user_id": string }; Returns: {
              "request_id": string,"scheduled_for": string
            }[]
                           },
"requeue_scan_job_if_expired":
{ Args: { "p_expected_lease_id": string,"p_job_id": string,"p_legacy_cutoff": string }; Returns: boolean
                           },
"required_tos_version":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"save_transcription_part":
{ Args: { "p_attempts": number,"p_job_id": string,"p_language_code": string,"p_last_error": string,"p_lease_id": string,"p_part_position": number,"p_phrases": Json,"p_status": string,"p_transcription_id": string }; Returns: boolean
                           },
"save_user_provider_credential_atomic":
{ Args: { "p_credential_id": string,"p_encrypted_key": string,"p_expected_encrypted_key": string,"p_expected_key_version": string,"p_provider": string,"p_reset_retry_policy": boolean,"p_user_id": string }; Returns: {
              "credential_id": string,"key_version": string,"retry_limit": number,"status": string
            }[]
                           },
"transcription_eligible_credentials":
{ Args: { "p_channel_id": string }; Returns: {
              "added_at": string,"credential_id": string,"key_version": string,"ord": number,"retry_limit": number,"user_id": string
            }[]
                           },
"transcription_review_stats":
{ Args: { "p_days": number }; Returns: {
              "doubtful_phrases": number,"status": string,"total": number
            }[]
                           },
"update_transcription_profile":
{ Args: { "p_admin_username": string,"p_input_price": number,"p_model": string,"p_output_price": number,"p_thinking_level": string }; Returns: {
              "input_price_per_million": number,"model": string,"output_price_per_million": number,"thinking_level": string,"updated_at": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
