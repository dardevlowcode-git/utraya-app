-- Commento didattico:
-- Scopo del file: migrazione database Supabase per creare/aggiornare tabelle, vincoli e policy di sicurezza.
-- Flusso: viene eseguito in ordine cronologico; gli oggetti creati qui vengono poi usati da servizi API e pagine dell'app.

-- ============================================================
-- Migration 009: Cron Settings (schedulazione manuale trascrizioni)
-- Utraya V1
-- Abilita/disabilita il cron trascrizioni e il limite batch per-run;
-- la UI admin legge/scrive qui, il cron legge solo. Nessun segreto.
-- ============================================================

CREATE TABLE IF NOT EXISTS cron_settings (
  schedule_key TEXT PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  batch_limit  INTEGER NOT NULL DEFAULT 10
               CHECK (batch_limit BETWEEN 1 AND 50),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS abilitata senza policy per anon/authenticated:
-- solo service_role (bypass RLS) legge/scrive.
ALTER TABLE cron_settings ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at (riusa update_updated_at_column() da 001).
DROP TRIGGER IF EXISTS cron_settings_updated_at ON cron_settings;
CREATE TRIGGER cron_settings_updated_at
  BEFORE UPDATE ON cron_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed riga trascrizioni: nessun segreto, solo default operativi.
INSERT INTO cron_settings (schedule_key, enabled, batch_limit)
VALUES ('transcripts', TRUE, 10)
ON CONFLICT DO NOTHING;
