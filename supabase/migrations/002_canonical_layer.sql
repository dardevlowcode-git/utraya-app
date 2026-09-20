-- Commento didattico:
-- Scopo del file: migrazione database Supabase per creare/aggiornare tabelle, vincoli e policy di sicurezza.
-- Flusso: viene eseguito in ordine cronologico; gli oggetti creati qui vengono poi usati da servizi API e pagine dell'app.

-- ============================================================
-- Migration 002: Canonical Layer
-- Utraya V1
-- ============================================================

-- ============================================================
-- CHANNELS (canonical — shared across all users)
-- ============================================================
CREATE TABLE IF NOT EXISTS channels (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  youtube_channel_id TEXT NOT NULL UNIQUE,
  handle             TEXT,
  title              TEXT NOT NULL,
  description        TEXT,
  thumbnail_url      TEXT,
  subscriber_count   BIGINT,
  video_count        INTEGER,
  custom_url         TEXT,
  youtube_metadata   JSONB,  -- full YouTube API response for future use
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'inactive', 'error')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_youtube_id ON channels(youtube_channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_handle ON channels(handle) WHERE handle IS NOT NULL;

-- ============================================================
-- VIDEOS (canonical — shared)
-- ============================================================
CREATE TABLE IF NOT EXISTS videos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id          UUID NOT NULL REFERENCES channels(id),
  youtube_video_id    TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  description         TEXT,
  thumbnail_url       TEXT,
  published_at        TIMESTAMPTZ NOT NULL,
  duration_seconds    INTEGER,
  video_url           TEXT NOT NULL,
  video_type          TEXT NOT NULL DEFAULT 'standard'
                        CHECK (video_type IN ('standard', 'live_replay', 'premiere')),
  availability_status TEXT NOT NULL DEFAULT 'available'
                        CHECK (availability_status IN ('available', 'unavailable', 'private')),
  youtube_metadata    JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_type ON videos(video_type);

-- ============================================================
-- VIDEO ANALYSIS
-- ============================================================
CREATE TABLE IF NOT EXISTS video_analysis (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id            UUID NOT NULL REFERENCES videos(id),
  analysis_status     TEXT NOT NULL DEFAULT 'pending'
                        CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed')),
  model_used          TEXT,
  prompt_profile_id   UUID,  -- references ai_prompt_profiles (future table)
  analyzed_at         TIMESTAMPTZ,
  analyzed_by_user_id UUID REFERENCES users(id),
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(video_id)  -- one analysis record per video
);

CREATE INDEX IF NOT EXISTS idx_video_analysis_video ON video_analysis(video_id);
CREATE INDEX IF NOT EXISTS idx_video_analysis_status ON video_analysis(analysis_status);

-- ============================================================
-- VIDEO ANALYSIS RAW (full AI provider output — for audit/debugging)
-- ============================================================
CREATE TABLE IF NOT EXISTS video_analysis_raw (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_analysis_id UUID NOT NULL REFERENCES video_analysis(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,  -- 'gemini', etc.
  raw_request       JSONB,
  raw_response      JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_va_raw_analysis ON video_analysis_raw(video_analysis_id);

-- ============================================================
-- VIDEO LOCALIZED CONTENT (per video + per language)
-- ============================================================
CREATE TABLE IF NOT EXISTS video_localized_content (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_analysis_id UUID NOT NULL REFERENCES video_analysis(id),
  video_id          UUID NOT NULL REFERENCES videos(id),
  language_code     TEXT NOT NULL,  -- 'it', 'en', etc.
  short_summary     TEXT,           -- one sentence
  full_summary      TEXT,           -- rich summary
  general_category  TEXT,           -- free text in V1
  subcategory       TEXT,           -- free text in V1
  highlights_text   TEXT,           -- free text with timestamps in V1
  is_admin_edited   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(video_id, language_code)   -- reuse rule: one record per (video, language)
);

CREATE INDEX IF NOT EXISTS idx_vlc_video_lang ON video_localized_content(video_id, language_code);
CREATE INDEX IF NOT EXISTS idx_vlc_admin_edited ON video_localized_content(is_admin_edited) WHERE is_admin_edited = TRUE;

-- ============================================================
-- CANONICAL SYNC STATE
-- ============================================================
CREATE TABLE IF NOT EXISTS canonical_sync_state (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id         UUID NOT NULL UNIQUE REFERENCES channels(id),
  last_sync_at       TIMESTAMPTZ,
  last_sync_status   TEXT CHECK (last_sync_status IN ('success', 'failed', 'partial')),
  next_sync_at       TIMESTAMPTZ,
  videos_found_count INTEGER
);

-- Triggers
CREATE TRIGGER channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER vlc_updated_at
  BEFORE UPDATE ON video_localized_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
