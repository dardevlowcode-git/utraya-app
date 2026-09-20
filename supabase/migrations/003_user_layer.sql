-- Commento didattico:
-- Scopo del file: migrazione database Supabase per creare/aggiornare tabelle, vincoli e policy di sicurezza.
-- Flusso: viene eseguito in ordine cronologico; gli oggetti creati qui vengono poi usati da servizi API e pagine dell'app.

-- ============================================================
-- Migration 003: User Layer
-- Utraya V1
-- ============================================================

-- ============================================================
-- USER CHANNELS (which channels a user follows)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_channels (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  UNIQUE(user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_user_channels_user ON user_channels(user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_channels_channel ON user_channels(channel_id) WHERE is_active = TRUE;

-- ============================================================
-- USER CHANNEL PREFERENCES (per user-channel scheduling)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_channel_preferences (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_channel_id       UUID NOT NULL UNIQUE REFERENCES user_channels(id) ON DELETE CASCADE,
  sync_frequency_hours  INTEGER NOT NULL DEFAULT 24
                          CHECK (sync_frequency_hours IN (6, 12, 24, 48, 168)),
  is_paused             BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================
-- USER VIDEO STATES (sparse model — only create on user action)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_video_states (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id    UUID NOT NULL REFERENCES videos(id),
  seen_status TEXT NOT NULL DEFAULT 'unseen'
                CHECK (seen_status IN ('unseen', 'seen', 'hidden')),
  seen_at     TIMESTAMPTZ,
  hidden_at   TIMESTAMPTZ,
  UNIQUE(user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_uvs_user ON user_video_states(user_id);
CREATE INDEX IF NOT EXISTS idx_uvs_user_seen ON user_video_states(user_id, seen_status);

-- ============================================================
-- WATCHLISTS
-- ============================================================
CREATE TABLE IF NOT EXISTS watchlists (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_one_default_per_user
  ON watchlists(user_id)
  WHERE is_default = TRUE; -- only one default per user

-- ============================================================
-- WATCHLIST ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS watchlist_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  video_id     UUID NOT NULL REFERENCES videos(id),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(watchlist_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist ON watchlist_items(watchlist_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_video ON watchlist_items(video_id);
