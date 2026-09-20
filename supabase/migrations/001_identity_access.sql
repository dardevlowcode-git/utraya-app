-- Commento didattico:
-- Scopo del file: migrazione database Supabase per creare/aggiornare tabelle, vincoli e policy di sicurezza.
-- Flusso: viene eseguito in ordine cronologico; gli oggetti creati qui vengono poi usati da servizi API e pagine dell'app.

-- ============================================================
-- Migration 001: Identity & Access
-- Utraya V1
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE CHECK (name IN ('user', 'super_admin'))
);

-- Seed roles
INSERT INTO roles (name) VALUES ('user'), ('super_admin')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY,  -- mirrors auth.users.id
  email              TEXT NOT NULL UNIQUE,
  display_name       TEXT,
  avatar_url         TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'it',
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================================
-- USER IDENTITIES (OAuth providers)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_identities (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,  -- 'google', 'microsoft', etc.
  provider_user_id TEXT NOT NULL,
  email            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- ============================================================
-- USER ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  PRIMARY KEY (user_id, role_id)
);

-- ============================================================
-- ALLOWLIST ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS allowlist_entries (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email     TEXT NOT NULL UNIQUE,
  added_by  UUID REFERENCES users(id),
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_allowlist_email ON allowlist_entries(email) WHERE is_active = TRUE;

-- ============================================================
-- ADMIN ACTIONS AUDIT
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_actions_audit (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id UUID NOT NULL REFERENCES users(id),
  action_type   TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_actions_audit(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_actions_audit(created_at DESC);

-- ============================================================
-- USER PROVIDER CREDENTIALS (API keys — stored encrypted server-side)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_provider_credentials (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('youtube', 'gemini')),
  -- NOTE: actual key value stored in encrypted column or separate secret store
  -- In V1, use encrypted_key column with pgcrypto or store reference to secret manager
  encrypted_key     TEXT,  -- AES-256 encrypted, key stored server-side only
  is_configured     BOOLEAN NOT NULL DEFAULT FALSE,
  is_valid          BOOLEAN,
  last_validated_at TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS credential_checks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credential_id UUID NOT NULL REFERENCES user_provider_credentials(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_valid      BOOLEAN NOT NULL,
  error_message TEXT,
  error_type    TEXT CHECK (error_type IN ('temporary', 'structural'))
);

CREATE INDEX IF NOT EXISTS idx_cred_checks_credential ON credential_checks(credential_id, checked_at DESC);

-- ============================================================
-- Updated_at trigger function (reusable)
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER user_provider_credentials_updated_at
  BEFORE UPDATE ON user_provider_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
