-- Commento didattico:
-- Scopo del file: crea una tabella temporanea e server-only per diagnosi dei fetch transcript in DEV.
-- Flusso: ogni fetch-run registra i tentativi per client senza salvare payload grezzi o testo transcript.
-- Vincolo operativo: applicare solo al progetto Supabase utraya-dev; non promuovere a preprod/main.

CREATE TABLE public.transcript_fetch_diagnostics (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fetch_run_id             UUID NOT NULL,
  video_id                 UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  request_id               TEXT,
  attempt_no               SMALLINT NOT NULL CHECK (attempt_no >= 0),
  client_name              TEXT CHECK (client_name IN ('ANDROID', 'TVHTML5')),
  stage                    TEXT NOT NULL CHECK (stage IN ('configuration', 'player', 'timedtext')),
  outcome                  TEXT NOT NULL CHECK (outcome IN (
                             'configuration_error', 'http_error', 'playability_blocked',
                             'no_usable_track', 'timeout', 'network_error', 'invalid_json',
                             'timedtext_empty', 'timedtext_error', 'fetched', 'unknown_error'
                           )),
  player_http_status       SMALLINT CHECK (player_http_status BETWEEN 100 AND 599),
  player_status_text       TEXT CHECK (char_length(player_status_text) <= 256),
  player_content_type      TEXT CHECK (char_length(player_content_type) <= 128),
  playability_status       TEXT CHECK (char_length(playability_status) <= 100),
  player_reason            TEXT CHECK (char_length(player_reason) <= 1024),
  player_subreason         TEXT CHECK (char_length(player_subreason) <= 1024),
  player_error_code        TEXT CHECK (char_length(player_error_code) <= 100),
  player_error_message     TEXT CHECK (char_length(player_error_message) <= 1024),
  track_count              INTEGER CHECK (track_count >= 0),
  usable_track_count       INTEGER CHECK (usable_track_count >= 0),
  selected_track_language  TEXT CHECK (char_length(selected_track_language) <= 64),
  selected_track_kind      TEXT CHECK (char_length(selected_track_kind) <= 32),
  timedtext_http_status    SMALLINT CHECK (timedtext_http_status BETWEEN 100 AND 599),
  timedtext_status_text    TEXT CHECK (char_length(timedtext_status_text) <= 256),
  timedtext_content_type   TEXT CHECK (char_length(timedtext_content_type) <= 128),
  player_duration_ms       INTEGER CHECK (player_duration_ms >= 0),
  timedtext_duration_ms    INTEGER CHECK (timedtext_duration_ms >= 0),
  error_type               TEXT CHECK (char_length(error_type) <= 100),
  error_code               TEXT CHECK (char_length(error_code) <= 100),
  error_message            TEXT CHECK (char_length(error_message) <= 1024),
  attempt_started_at       TIMESTAMPTZ NOT NULL,
  completed_at             TIMESTAMPTZ NOT NULL,
  runtime_environment      TEXT CHECK (char_length(runtime_environment) <= 64),
  runtime_region           TEXT CHECK (char_length(runtime_region) <= 100),
  deployment_id            TEXT CHECK (char_length(deployment_id) <= 200),
  git_commit_sha           TEXT CHECK (char_length(git_commit_sha) <= 64),
  git_commit_ref           TEXT CHECK (char_length(git_commit_ref) <= 100),
  node_version             TEXT CHECK (char_length(node_version) <= 64),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transcript_fetch_diagnostics_run_attempt_key UNIQUE (fetch_run_id, attempt_no),
  CONSTRAINT transcript_fetch_diagnostics_request_id_length CHECK (
    request_id IS NULL OR char_length(request_id) <= 128
  )
);

CREATE INDEX transcript_fetch_diagnostics_video_created_idx
  ON public.transcript_fetch_diagnostics(video_id, created_at DESC);
CREATE INDEX transcript_fetch_diagnostics_run_id_idx
  ON public.transcript_fetch_diagnostics(fetch_run_id);

ALTER TABLE public.transcript_fetch_diagnostics ENABLE ROW LEVEL SECURITY;

-- Nessun client Data API: RLS e ACL client espliciti. Una migrazione successiva
-- restringe service_role ai soli SELECT, INSERT e DELETE per lo storico append-only.
REVOKE ALL ON TABLE public.transcript_fetch_diagnostics FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.transcript_fetch_diagnostics TO service_role;
