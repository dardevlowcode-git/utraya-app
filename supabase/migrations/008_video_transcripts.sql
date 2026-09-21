-- Commento didattico:
-- Scopo del file: migrazione database Supabase per creare/aggiornare tabelle, vincoli e policy di sicurezza.
-- Flusso: viene eseguito in ordine cronologico; gli oggetti creati qui vengono poi usati da servizi API e pagine dell'app.

-- ============================================================
-- Migration 008: Video Transcripts
-- Utraya V1
-- Solo NUOVI video da qui in avanti; solo lingua principale;
-- uso AI interno mai mostrato; tutto su Vercel/Supabase.
-- ============================================================

-- Tabella cache trascrizioni YouTube (una riga per video + lingua).
-- I video storici sono marcati 'legacy_missing' dal backfill T4
-- in coda al file, cosi non vengono ritentati.
CREATE TABLE IF NOT EXISTS video_transcripts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id          UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  youtube_video_id  TEXT NOT NULL,
  language_code     TEXT NOT NULL DEFAULT 'unknown',
  kind              TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (kind IN ('standard', 'asr', 'unknown')),
  is_asr            BOOLEAN,
  transcript_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (transcript_status IN ('pending', 'fetched', 'missing', 'failed', 'legacy_missing')),
  transcript_text   TEXT,
  segments          JSONB,
  source            TEXT NOT NULL DEFAULT 'youtubei-timedtext',
  fetched_at        TIMESTAMPTZ,
  error_details     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(video_id, language_code),
  UNIQUE(youtube_video_id, language_code)
);

CREATE INDEX IF NOT EXISTS idx_video_transcripts_video ON video_transcripts(video_id);
CREATE INDEX IF NOT EXISTS idx_video_transcripts_youtube ON video_transcripts(youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_video_transcripts_status ON video_transcripts(transcript_status);

-- RLS abilitata senza policy per anon/authenticated:
-- solo service_role (bypass RLS) legge/scrive. Nessun dato AI esposto.
ALTER TABLE video_transcripts ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at (riusa update_updated_at_column() da 001).
DROP TRIGGER IF EXISTS video_transcripts_updated_at ON video_transcripts;
CREATE TRIGGER video_transcripts_updated_at
  BEFORE UPDATE ON video_transcripts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Backfill T4: marca i video preesistenti come legacy,
-- cosi il fetcher futuro processa solo i NUOVI video.
-- ============================================================
INSERT INTO video_transcripts (video_id, youtube_video_id, language_code, kind, transcript_status, source)
SELECT id, youtube_video_id, 'unknown', 'unknown', 'legacy_missing', 'backfill-legacy'
FROM videos
ON CONFLICT (youtube_video_id, language_code) DO NOTHING;
