-- Schema/auth minimo ma fedele ai confini e ai vincoli usati dalle migration del ticket.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role LOGIN BYPASSRLS;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID $$;

CREATE FUNCTION public.update_updated_at_column() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

GRANT USAGE ON SCHEMA public, auth TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
-- `auth.uid()` è usata nelle policy RLS valutate come `authenticated`.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted'))
);

-- Confini usati dalle policy RLS delle trascrizioni (hardening 20260924153504) e dalla nuova eleggibilità (K5).
CREATE TABLE public.user_roles (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL
);

CREATE TABLE public.roles (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE FUNCTION public.is_super_admin() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = (SELECT auth.uid()) AND r.name = 'super_admin'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role, authenticated;

CREATE TABLE public.legal_acceptances (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('tos', 'tos_vexatorious')),
  document_version TEXT NOT NULL,
  document_hash TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.user_provider_credentials (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CONSTRAINT user_provider_credentials_provider_check CHECK (provider IN ('youtube', 'gemini')),
  encrypted_key TEXT,
  is_configured BOOLEAN NOT NULL DEFAULT FALSE,
  is_valid BOOLEAN,
  last_validated_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE public.credential_checks (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  credential_id UUID NOT NULL REFERENCES public.user_provider_credentials(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_valid BOOLEAN NOT NULL,
  error_message TEXT,
  error_type TEXT CHECK (error_type IN ('temporary', 'structural'))
);

CREATE TABLE public.channels (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  youtube_channel_id TEXT NOT NULL UNIQUE,
  handle TEXT,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  subscriber_count BIGINT,
  video_count INTEGER,
  custom_url TEXT,
  youtube_metadata JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.videos (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES public.channels(id),
  youtube_video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,
  video_url TEXT NOT NULL,
  video_type TEXT NOT NULL DEFAULT 'standard' CHECK (video_type IN ('standard', 'live_replay', 'premiere')),
  availability_status TEXT NOT NULL DEFAULT 'available' CHECK (availability_status IN ('available', 'unavailable', 'private')),
  youtube_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.user_channels (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  UNIQUE(user_id, channel_id)
);

CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  priority INTEGER NOT NULL DEFAULT 5,
  payload JSONB,
  deduplication_key TEXT UNIQUE,
  created_by_user_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ
);

CREATE TABLE public.job_attempts (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  error_details JSONB
);

CREATE TABLE public.api_usage_events (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CONSTRAINT api_usage_events_provider_check CHECK (provider IN ('youtube', 'gemini')),
  operation TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome TEXT NOT NULL,
  http_status SMALLINT,
  error_category TEXT,
  model TEXT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  total_tokens BIGINT,
  estimated_cost_usd NUMERIC,
  input_rate_usd_per_million NUMERIC,
  output_rate_usd_per_million NUMERIC,
  quota_units INTEGER,
  quota_bucket TEXT
);

CREATE TABLE public.canonical_sync_state (
  channel_id UUID PRIMARY KEY REFERENCES public.channels(id) ON DELETE CASCADE,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  videos_found_count INTEGER
);

CREATE TABLE public.video_transcripts (
  id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  language_code TEXT NOT NULL DEFAULT 'unknown',
  kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('standard', 'asr', 'unknown')),
  is_asr BOOLEAN,
  transcript_status TEXT NOT NULL DEFAULT 'pending' CHECK (transcript_status IN ('pending', 'fetched', 'missing', 'failed', 'legacy_missing')),
  transcript_text TEXT,
  segments JSONB,
  source TEXT NOT NULL DEFAULT 'youtubei-timedtext',
  fetched_at TIMESTAMPTZ,
  error_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(video_id, language_code),
  UNIQUE(youtube_video_id, language_code)
);

-- Emula i grant di default del project service_role prima che le migrations possano restringere ACL specifici.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- RLS delle trascrizioni (K2) valuta `videos` e `user_channels` nella USING: `authenticated`
-- deve poterle leggere, come nel progetto reale dove le policy di lettura sono già attive.
GRANT SELECT ON TABLE public.videos, public.user_channels TO authenticated;

INSERT INTO public.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'owner-b@example.invalid');

-- Existing credential proves that the retry-limit migration defaults legacy rows without overwriting overrides.
INSERT INTO public.user_provider_credentials (id, user_id, provider, encrypted_key, is_configured)
VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'youtube', 'cipher-old', TRUE);
