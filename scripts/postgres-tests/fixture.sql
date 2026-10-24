-- Schema/auth minimo ma fedele ai confini Supabase: i ruoli e le funzioni JWT che
-- le migrazioni reali usano, più i pochi oggetti `auth`/`extensions` che Supabase
-- fornisce e che le migrazioni richiamano. Nessuna tabella applicativa è creata
-- qui: tutte vengono dalle migrazioni vere, applicate in ordine da `run.sh`.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role LOGIN BYPASSRLS;

-- Supabase tiene pgcrypto nello schema `extensions`; la migrazione di cancellazione
-- account qualifica `extensions.gen_random_bytes`, quindi replicarlo è necessario.
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

CREATE SCHEMA auth;

-- `auth.users` esiste su Supabase e le migrazioni vi fanno riferimento
-- (legal_acceptances.user_id, is_current_user_allowlisted, execute_user_deletion).
CREATE TABLE auth.users (
  id    UUID PRIMARY KEY,
  email TEXT NOT NULL
);

-- Le policy RLS confrontano il claim JWT con `auth.uid()`; questa fixture replica
-- la funzione reale di Supabase, che legge `request.jwt.claim.sub`.
CREATE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID $$;

-- La funzione reale di Supabase legge il claim completo da `request.jwt.claims`
-- (JSON) con fallback sui singoli claim; i test RLS impostano entrambe le forme.
CREATE FUNCTION auth.jwt() RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB,
    pg_catalog.jsonb_build_object(
      'sub', NULLIF(current_setting('request.jwt.claim.sub', TRUE), ''),
      'role', NULLIF(current_setting('request.jwt.claim.role', TRUE), '')
    )
  )
$$;

-- Il progetto reale gira con `public` già esposto a questi ruoli; le migrazioni
-- concedono/revocano i privilegi specifici, ma l'USAGE sugli schemi è la baseline.
GRANT USAGE ON SCHEMA public, auth, extensions TO service_role;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
-- `service_role` gestisce `auth.users` in Supabase (admin API); i test ne hanno
-- bisogno per creare le righe gemelle fra `auth.users` e `public.users`.
GRANT ALL ON auth.users TO service_role;

-- Baseline dei privilegi Supabase: sulle nuove istanze `anon` e `authenticated`
-- ricevono i privilegi su tutte le tabelle di `public` (le migrazioni poi revocano
-- tabella per tabella dove serve). Senza questa baseline le revoche delle migrazioni
-- sarebbero prive di oggetto e i test RLS leggerebbero un permesso diverso dal reale.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Su Supabase `service_role` ha i privilegi sulle tabelle create dalle migrazioni
-- (default privileges), anche quando una migrazione restringe gli ACL specifici.
GRANT ALL ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated;