/* I CHECK PostgreSQL non sono espressi dal generatore: qui restringiamo i tipi
 * senza modificare il file generato. Le altre colonne restano quelle generate. */
import type { Database as GeneratedDatabase } from './database.generated'

export type { Json } from './database.generated'

type Override<T, Changes> = {
  [Key in keyof T]: Key extends keyof Changes ? Changes[Key] : T[Key]
}

type RowInsertUpdate<Columns> = { Row: Columns; Insert: Columns; Update: Columns }
type RowInsert<Columns, UpdateColumns = never> = { Row: Columns; Insert: Columns } &
  ([UpdateColumns] extends [never] ? object : { Update: UpdateColumns })

type UserStatus = 'active' | 'suspended' | 'deleted'
type Provider = 'youtube' | 'gemini'
type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'
type CredentialMode = 'requester' | 'channel_rotation'
type CredentialError = 'temporary' | 'structural' | null
type JobStatus = 'pending' | 'running' | 'completed' | 'failed'
type VideoAvailability = 'available' | 'unavailable' | 'private'
type IncidentStatus = 'open' | 'investigating' | 'resolved'
type TranscriptionPartStatus = 'pending' | 'done' | 'missing'
type PendingCompletionStatus = 'pending' | 'completed' | 'failed'

type TableOverrides = {
  users: RowInsertUpdate<{ status: UserStatus }>
  roles: RowInsertUpdate<{ name: 'user' | 'super_admin' }>
  user_provider_credentials: RowInsert<{ provider: Provider }>
  shared_provider_retry_settings: RowInsert<{ provider_key: 'youtube_innertube' }>
  credential_checks: RowInsert<{ error_type: CredentialError }>
  api_usage_events: RowInsert<{
    provider: Provider
    outcome: 'success' | 'http_error' | 'network_error' | 'timeout'
    error_category: 'provider_error' | 'network_error' | 'timeout' | 'unknown' | null
    quota_bucket: 'default' | 'search' | null
  }>
  channels: RowInsertUpdate<{ status: 'active' | 'inactive' | 'error' }>
  videos: RowInsert<{
    video_type: 'standard' | 'live_replay' | 'premiere'
    availability_status: VideoAvailability
  }, { availability_status: VideoAvailability }>
  video_analysis: RowInsertUpdate<{ analysis_status: 'pending' | 'processing' | 'completed' | 'failed' }>
  transcription_relaunch_audit: RowInsert<{ credential_mode: CredentialMode }>
  transcription_profile: RowInsertUpdate<{ thinking_level: ThinkingLevel }>
  transcriptions: RowInsertUpdate<{
    status: 'pending' | 'running' | 'complete' | 'needs_review' | 'unavailable'
    thinking_level: ThinkingLevel
  }>
  transcription_parts: RowInsertUpdate<{ status: TranscriptionPartStatus }>
  canonical_sync_state: RowInsertUpdate<{ last_sync_status: 'success' | 'failed' | 'partial' | null }>
  user_video_states: RowInsertUpdate<{ seen_status: 'unseen' | 'seen' | 'hidden' }>
  jobs: RowInsertUpdate<{ status: JobStatus }>
  job_attempts: RowInsertUpdate<{ status: 'running' | 'completed' | 'failed' }>
  app_logs: RowInsert<{ level: 'info' | 'warn' | 'error' | 'debug' }>
  incidents: RowInsert<{
    severity: 'low' | 'medium' | 'high' | 'critical'
    status: IncidentStatus
  }, { status: IncidentStatus }>
  user_deletion_requests: RowInsertUpdate<{
    status: 'pending' | 'cancelled' | 'executing' | 'completed' | 'failed'
    previous_user_status: UserStatus
  }>
}

type GeneratedTables = GeneratedDatabase['public']['Tables']
type AssertNoErrors<T extends never> = T
type TableOverrideErrors = {
  [Table in keyof TableOverrides]: Table extends keyof GeneratedTables
    ? {
        [Part in keyof TableOverrides[Table]]: Part extends 'Row' | 'Insert' | 'Update'
          ? Part extends keyof GeneratedTables[Table]
            ? Exclude<keyof TableOverrides[Table][Part], keyof GeneratedTables[Table][Part]>
            : Part
          : Part
      }[keyof TableOverrides[Table]]
    : Table
}[keyof TableOverrides]

type Tables = AssertNoErrors<TableOverrideErrors> extends never ? {
  [Table in keyof GeneratedTables]: Table extends keyof TableOverrides
    ? { [Part in keyof GeneratedTables[Table]]: Part extends keyof TableOverrides[Table]
        ? Override<GeneratedTables[Table][Part], TableOverrides[Table][Part]>
        : GeneratedTables[Table][Part] }
    : GeneratedTables[Table]
} : never

// Anche le union delle RPC precedentemente esposte restano disponibili.
type RawFunctions = GeneratedDatabase['public']['Functions']
// I due overload generati diventano un unico contratto con provider opzionale.
type ClaimProvider = Extract<RawFunctions['claim_channel_scan_provider_request'], {
  Args: { p_provider: string }
}>
type GeneratedFunctions = Override<RawFunctions, {
  claim_channel_scan_provider_request: Override<ClaimProvider, {
    Args: Omit<ClaimProvider['Args'], 'p_provider'> & { p_provider?: 'youtube' }
  }>
}>
type FunctionOverrides = {
  relaunch_missing_transcription_parts: {
    Returns: { status: 'relaunched' | 'not_found' | 'no_missing' | 'busy'; credential_mode: CredentialMode | null }
  }
  update_transcription_profile: { Returns: { thinking_level: ThinkingLevel } }
  commit_fenced_channel_import: { Args: { p_sync_status: 'success' | 'partial' } }
  finish_credential_validation_job_attempt: { Args: { p_status: PendingCompletionStatus; p_error_type: CredentialError } }
  finish_scan_job_attempt: { Args: { p_status: 'completed' | 'failed' } }
  save_user_provider_credential_atomic: {
    Args: { p_provider: Provider }
    Returns: { status: 'saved' | 'conflict' }
  }
  claim_channel_scan_provider_request: {
    Returns: { status: 'assigned' | 'cached' | 'waiting' | 'exhausted' | 'backoff' | 'disabled' }
  }
  finish_channel_scan_provider_attempt: { Args: { p_outcome: 'success' | 'retryable_error' | 'ineligible' } }
  finish_transcription_job_attempt: { Args: { p_status: PendingCompletionStatus } }
  save_transcription_part: { Args: { p_status: TranscriptionPartStatus } }
  claim_transcription_job_credential: { Returns: { status: 'assigned' | 'waiting' | 'exhausted' | 'lease_lost' } }
  release_transcription_job_credential: { Args: { p_status: 'exhausted' | 'ineligible' } }
  claim_transcription_part_credential: { Returns: { status: 'assigned' | 'none' | 'lease_lost' } }
}

type InvalidReturnFields<Returns, Changes> = Returns extends (infer Item)[]
  ? Exclude<keyof Changes, keyof Item>
  : Returns extends object ? Exclude<keyof Changes, keyof Returns> : 'Returns must be an object or array'

type FunctionOverrideErrors = {
  [Fn in keyof FunctionOverrides]: Fn extends keyof GeneratedFunctions
    ? {
        [Part in keyof FunctionOverrides[Fn]]: Part extends 'Args' | 'Returns'
          ? Part extends keyof GeneratedFunctions[Fn]
            ? Part extends 'Returns'
              ? InvalidReturnFields<GeneratedFunctions[Fn][Part], FunctionOverrides[Fn][Part]>
              : Exclude<keyof FunctionOverrides[Fn][Part], keyof GeneratedFunctions[Fn][Part]>
            : Part
          : Part
      }[keyof FunctionOverrides[Fn]]
    : Fn
}[keyof FunctionOverrides]

type ApplyFunction<T, Changes> = T extends { Args: infer Args; Returns: infer Returns }
  ? Override<T, {
      Args: Changes extends { Args: infer ArgsChanges } ? Override<Args, ArgsChanges> : Args
      Returns: Changes extends { Returns: infer ReturnChanges }
        ? Returns extends (infer Item)[] ? Override<Item, ReturnChanges>[] : Override<Returns, ReturnChanges>
        : Returns
    }>
  : T

type Functions = AssertNoErrors<FunctionOverrideErrors> extends never ? {
  [Fn in keyof GeneratedFunctions]: Fn extends keyof FunctionOverrides
    ? ApplyFunction<GeneratedFunctions[Fn], FunctionOverrides[Fn]>
    : GeneratedFunctions[Fn]
} : never

export type Database = Override<GeneratedDatabase, {
  public: Override<GeneratedDatabase['public'], { Tables: Tables; Functions: Functions }>
}>
