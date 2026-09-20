-- Commento didattico:
-- Scopo del file: migrazione database Supabase per creare/aggiornare tabelle, vincoli e policy di sicurezza.
-- Flusso: viene eseguito in ordine cronologico; gli oggetti creati qui vengono poi usati da servizi API e pagine dell'app.

-- ============================================================
-- Migration 004: Jobs & Operations
-- Utraya V1
-- ============================================================

-- ============================================================
-- JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  priority            INTEGER NOT NULL DEFAULT 5,
  payload             JSONB,
  deduplication_key   TEXT UNIQUE,  -- prevents duplicate jobs for same work item
  created_by_user_id  UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_dedup ON jobs(deduplication_key) WHERE deduplication_key IS NOT NULL;

-- ============================================================
-- JOB ATTEMPTS
-- ============================================================
CREATE TABLE IF NOT EXISTS job_attempts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id         UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  error_message  TEXT,
  error_details  JSONB
);

CREATE INDEX IF NOT EXISTS idx_job_attempts_job ON job_attempts(job_id);

-- ============================================================
-- JOB LOCKS (prevent duplicate processing)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_locks (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lock_key   TEXT NOT NULL UNIQUE,
  locked_by  TEXT NOT NULL,  -- job_id or worker identifier
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_locks_expires ON job_locks(expires_at);

-- ============================================================
-- APP LOGS (7-day retention — cleaned up automatically)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level      TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'debug')),
  message    TEXT NOT NULL,
  context    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_logs_created ON app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level, created_at DESC);

-- ============================================================
-- AUDIT LOGS (7-day retention)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id),
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  details       JSONB,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================================
-- INCIDENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS incidents (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  severity       TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title          TEXT NOT NULL,
  description    TEXT,
  related_job_id UUID REFERENCES jobs(id),
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'investigating', 'resolved')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, created_at DESC);

-- ============================================================
-- Log retention cleanup function (7-day TTL)
-- Call this via Supabase Cron: SELECT cleanup_old_logs();
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM app_logs WHERE created_at < NOW() - INTERVAL '7 days';
  DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '7 days';
  DELETE FROM job_locks WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
