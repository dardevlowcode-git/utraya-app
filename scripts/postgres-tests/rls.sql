-- Isolamento RLS sul database reale: le migrazioni applicate da `run.sh` creano le
-- policy, qui si dimostra che tengono. Integra (non sostituisce) le asserzioni SQL di
-- `assertions.sql`: quelle provano le RPC e i vincoli, questo file prova i confini
-- fra utenti, fra utente e admin, e l'anonimato.
--
-- Simulazione: `SET ROLE authenticated` + `request.jwt.claim.sub` (come farebbe
-- PostgREST con un JWT valido), esattamente come già fanno le asserzioni esistenti.
--
-- SEAM: PostgreSQL reale in container effimero (stesso di `assertions.sql`).
-- Regola 6: una policy permissiva è un BUG, non una verifica da indebolire: l'asserzione
-- che la scopre resta commentata con `-- BUG:` e viene segnalata.

-- `test_assert_true` di `assertions.sql` viene rimossa al termine di quel file: qui ne
-- serve una equivalente ma distinta, per non dipendere dall'ordine di esecuzione.
CREATE OR REPLACE FUNCTION public.test_assert_rls(p_condition BOOLEAN, p_label TEXT) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RLS assertion failed: %', p_label;
  END IF;
END;
$$;

-- =========================================================================
-- DATI: due utenti normali (A, B), un super admin (C) e un video/canale comuni.
-- Le righe per-utente sono scritte `service_role` (bypass RLS) e non da `authenticated`,
-- così restano indipendenti dalle policy che stiamo verificando.
-- =========================================================================
SET ROLE service_role;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'rls-a@example.invalid'),
  ('00000000-0000-4000-8000-00000000b001', 'rls-b@example.invalid'),
  ('00000000-0000-4000-8000-00000000c001', 'rls-admin@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, email, display_name) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'rls-a@example.invalid', 'Utente A'),
  ('00000000-0000-4000-8000-00000000b001', 'rls-b@example.invalid', 'Utente B'),
  ('00000000-0000-4000-8000-00000000c001', 'rls-admin@example.invalid', 'Admin C')
ON CONFLICT (id) DO NOTHING;

-- C è super admin: serve a dimostrare che l'eccezione admin è reale e limitata.
INSERT INTO public.user_roles (user_id, role_id)
SELECT '00000000-0000-4000-8000-00000000c001', r.id FROM public.roles r WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- Canale e video comuni: `channels`/`videos` sono canonici e leggibili da tutti gli
-- autenticati, ma solo l'admin scrive.
INSERT INTO public.channels (id, youtube_channel_id, title) VALUES
  ('20000000-0000-4000-8000-0000f1500001', 'UC-rls', 'Canale RLS')
ON CONFLICT DO NOTHING;
INSERT INTO public.videos (id, channel_id, youtube_video_id, title, published_at, video_url) VALUES
  ('21000000-0000-4000-8000-0000f1500001', '20000000-0000-4000-8000-0000f1500001', 'yt-rls', 'Video RLS', '2026-01-01T00:00:00Z', 'https://youtube.invalid/watch?v=yt-rls')
ON CONFLICT DO NOTHING;

-- Righe per-utente: una per A e una per B.
INSERT INTO public.user_identities (id, user_id, provider, provider_user_id, email) VALUES
  ('11000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', 'google', 'google-a', 'rls-a@example.invalid'),
  ('11000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', 'google', 'google-b', 'rls-b@example.invalid');

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id FROM (VALUES
  ('00000000-0000-4000-8000-00000000a001'::UUID),
  ('00000000-0000-4000-8000-00000000b001'::UUID)
) AS u(id) CROSS JOIN public.roles r WHERE r.name = 'user'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_provider_credentials (id, user_id, provider, encrypted_key, is_configured) VALUES
  ('12000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', 'youtube', 'cipher-rls-a', TRUE),
  ('12000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', 'youtube', 'cipher-rls-b', TRUE);

INSERT INTO public.credential_checks (id, credential_id, is_valid) VALUES
  ('13000000-0000-4000-8000-0000f150a010', '12000000-0000-4000-8000-0000f150a010', TRUE),
  ('13000000-0000-4000-8000-0000f150b010', '12000000-0000-4000-8000-0000f150b010', TRUE);

INSERT INTO public.user_channels (id, user_id, channel_id, is_active) VALUES
  ('14000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', '20000000-0000-4000-8000-0000f1500001', TRUE),
  ('14000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', '20000000-0000-4000-8000-0000f1500001', TRUE);

INSERT INTO public.user_channel_preferences (id, user_channel_id, sync_frequency_hours) VALUES
  ('15000000-0000-4000-8000-0000f150a010', '14000000-0000-4000-8000-0000f150a010', 24),
  ('15000000-0000-4000-8000-0000f150b010', '14000000-0000-4000-8000-0000f150b010', 24);

INSERT INTO public.user_video_states (id, user_id, video_id) VALUES
  ('16000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', '21000000-0000-4000-8000-0000f1500001'),
  ('16000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', '21000000-0000-4000-8000-0000f1500001');

INSERT INTO public.watchlists (id, user_id, name) VALUES
  ('17000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', 'Watchlist A'),
  ('17000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', 'Watchlist B');

INSERT INTO public.watchlist_items (id, watchlist_id, video_id) VALUES
  ('18000000-0000-4000-8000-0000f150a010', '17000000-0000-4000-8000-0000f150a010', '21000000-0000-4000-8000-0000f1500001'),
  ('18000000-0000-4000-8000-0000f150b010', '17000000-0000-4000-8000-0000f150b010', '21000000-0000-4000-8000-0000f1500001');

INSERT INTO public.legal_acceptances (id, user_id, document_kind, document_version, document_hash, locale, user_email_at_acceptance) VALUES
  ('19000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', 'tos', '2026-10-11-1', 'hash-f15-a', 'it', 'rls-a@example.invalid'),
  ('19000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', 'tos', '2026-10-11-1', 'hash-f15-b', 'it', 'rls-b@example.invalid');

INSERT INTO public.user_deletion_requests (id, user_id, scheduled_deletion_at, status) VALUES
  ('1a000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', NOW() + INTERVAL '7 days', 'pending'),
  ('1a000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', NOW() + INTERVAL '7 days', 'pending');

INSERT INTO public.api_usage_events (id, user_id, provider, operation, outcome) VALUES
  ('1b000000-0000-4000-8000-0000f150a010', '00000000-0000-4000-8000-00000000a001', 'youtube', 'channels.list', 'success'),
  ('1b000000-0000-4000-8000-0000f150b010', '00000000-0000-4000-8000-00000000b001', 'youtube', 'channels.list', 'success'),
  ('1b000000-0000-4000-8000-0000f150c010', '00000000-0000-4000-8000-00000000c001', 'youtube', 'channels.list', 'success');

INSERT INTO public.jobs (id, job_type, status, payload, created_by_user_id) VALUES
  ('1c000000-0000-4000-8000-0000f150a010', 'sync_channel_delta', 'pending', '{}'::JSONB, '00000000-0000-4000-8000-00000000a001'),
  ('1c000000-0000-4000-8000-0000f150b010', 'sync_channel_delta', 'pending', '{}'::JSONB, '00000000-0000-4000-8000-00000000b001');

INSERT INTO public.allowlist_entries (id, email) VALUES
  ('1d000000-0000-4000-8000-0000f1500001', 'rls-a@example.invalid');

INSERT INTO public.video_analysis (id, video_id, analysis_status) VALUES
  ('1e000000-0000-4000-8000-0000f1500001', '21000000-0000-4000-8000-0000f1500001', 'completed')
ON CONFLICT DO NOTHING;
INSERT INTO public.video_analysis_raw (id, video_analysis_id, provider) VALUES
  ('1f000000-0000-4000-8000-0000f1500001', '1e000000-0000-4000-8000-0000f1500001', 'gemini');

INSERT INTO public.admin_actions_audit (id, admin_user_id, action_type, target_type) VALUES
  ('20000000-0000-4000-8000-0000f150c010', '00000000-0000-4000-8000-00000000c001', 'test_action', 'test_target');

INSERT INTO public.job_attempts (id, job_id, attempt_number, status) VALUES
  ('21000000-0000-4000-8000-0000f150a010', '1c000000-0000-4000-8000-0000f150a010', 1, 'running');

RESET ROLE;

-- =========================================================================
-- Helper di sessione: gli stessi due usati dal resto del file.
-- =========================================================================
-- Apre una sessione `authenticated` con l'identità dell'utente indicato.
CREATE FUNCTION public.test_rls_scope(p_user UUID, p_label TEXT) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, FALSE);
  PERFORM set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', p_user::TEXT, 'role', 'authenticated')::TEXT, FALSE);
END;
$$;

-- Esegue una scrittura e restituisce TRUE se è stata possibile (RLS ha lasciato passare).
CREATE FUNCTION public.test_rls_can_write(p_sql TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_sql;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.test_rls_scope(UUID, TEXT), public.test_rls_can_write(TEXT) TO authenticated;

-- Legge una riga ignorando RLS (SECURITY DEFINER del superuser `postgres`): così le
-- asserzioni di scrittura non sono ingannate dalle stesse policy che stanno provando.
CREATE FUNCTION public.test_rls_row_exists(p_table TEXT, p_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', p_table)
    INTO v_exists USING p_id;
  RETURN v_exists;
END;
$$;
GRANT EXECUTE ON FUNCTION public.test_rls_row_exists(TEXT, UUID) TO authenticated;

-- =========================================================================
-- 1. A non legge le righe di B (e viceversa) sulle tabelle per-utente.
-- =========================================================================
CREATE TEMP TABLE rls_read_results (
  table_name TEXT,
  rows_for_a INTEGER,
  rows_for_b INTEGER
);
-- La lettura avviene come `authenticated`: il ruolo deve poter scrivere nell'area di raccolta.
GRANT ALL ON rls_read_results TO authenticated;

SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000a001', 'A');
INSERT INTO rls_read_results SELECT 'users',
  (SELECT count(*) FROM public.users WHERE id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.users WHERE id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'user_identities',
  (SELECT count(*) FROM public.user_identities WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.user_identities WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'user_roles',
  (SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'user_provider_credentials',
  (SELECT count(*) FROM public.user_provider_credentials WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.user_provider_credentials WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'credential_checks',
  (SELECT count(*) FROM public.credential_checks WHERE credential_id = '12000000-0000-4000-8000-0000f150a010'),
  (SELECT count(*) FROM public.credential_checks WHERE credential_id = '12000000-0000-4000-8000-0000f150b010');
INSERT INTO rls_read_results SELECT 'user_channels',
  (SELECT count(*) FROM public.user_channels WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.user_channels WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'user_channel_preferences',
  (SELECT count(*) FROM public.user_channel_preferences WHERE user_channel_id = '14000000-0000-4000-8000-0000f150a010'),
  (SELECT count(*) FROM public.user_channel_preferences WHERE user_channel_id = '14000000-0000-4000-8000-0000f150b010');
INSERT INTO rls_read_results SELECT 'user_video_states',
  (SELECT count(*) FROM public.user_video_states WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.user_video_states WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'watchlists',
  (SELECT count(*) FROM public.watchlists WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.watchlists WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'watchlist_items',
  (SELECT count(*) FROM public.watchlist_items WHERE watchlist_id = '17000000-0000-4000-8000-0000f150a010'),
  (SELECT count(*) FROM public.watchlist_items WHERE watchlist_id = '17000000-0000-4000-8000-0000f150b010');
INSERT INTO rls_read_results SELECT 'legal_acceptances',
  (SELECT count(*) FROM public.legal_acceptances WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.legal_acceptances WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'user_deletion_requests',
  (SELECT count(*) FROM public.user_deletion_requests WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.user_deletion_requests WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'api_usage_events',
  (SELECT count(*) FROM public.api_usage_events WHERE user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.api_usage_events WHERE user_id = '00000000-0000-4000-8000-00000000b001');
INSERT INTO rls_read_results SELECT 'jobs',
  (SELECT count(*) FROM public.jobs WHERE created_by_user_id = '00000000-0000-4000-8000-00000000a001'),
  (SELECT count(*) FROM public.jobs WHERE created_by_user_id = '00000000-0000-4000-8000-00000000b001');
RESET ROLE;

SELECT public.test_assert_rls(
  (SELECT bool_and(rows_for_a = 1 AND rows_for_b = 0) FROM rls_read_results),
  'A legge le proprie righe e nessuna di B su ogni tabella per-utente'
);

-- L'admin C vede invece entrambe le righe (l'eccezione admin esiste ed è reale).
SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000c001', 'admin C');
DO $$
BEGIN
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.users WHERE id IN ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000b001')) = 2
    AND (SELECT count(*) FROM public.user_provider_credentials WHERE user_id IN ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000b001')) = 2,
    'il super admin legge le righe di A e B'
  );
END;
$$;
RESET ROLE;

-- =========================================================================
-- 2. A non scrive righe di B: insert con user_id di B, update e delete delle righe di B.
-- La prova di lettura/scrittura usa `test_rls_*` (SECURITY DEFINER) per osservare lo stato
-- reale indipendentemente dalle policy in verifica.
-- =========================================================================
SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000a001', 'A');
DO $$
DECLARE
  v_spec RECORD;
  v_exists BOOLEAN;
  v_label TEXT;
BEGIN
  -- INSERT con la colonna di ownership di B: ogni scrittura deve essere respinta
  -- (la riga intrusa non deve esistere).
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('watchlists', 'user_id', '17000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.watchlists (id, user_id, name) VALUES ('17000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000b001', 'intrusa')$q$),
      ('user_video_states', 'user_id', '16000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.user_video_states (id, user_id, video_id) VALUES ('16000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000b001', '21000000-0000-4000-8000-0000f1500001')$q$),
      ('user_provider_credentials', 'user_id', '12000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.user_provider_credentials (id, user_id, provider, encrypted_key) VALUES ('12000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000b001', 'gemini', 'cipher-intrusa')$q$),
      ('user_channels', 'user_id', '14000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.user_channels (id, user_id, channel_id) VALUES ('14000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000b001', '20000000-0000-4000-8000-0000f1500001')$q$),
      ('user_identities', 'user_id', '11000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.user_identities (id, user_id, provider, provider_user_id, email) VALUES ('11000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000b001', 'github', 'gh-intruso', 'intruso@example.invalid')$q$),
      ('user_channel_preferences', 'user_channel_id', '15000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.user_channel_preferences (id, user_channel_id, sync_frequency_hours) VALUES ('15000000-0000-4000-8000-0000f150ff10', '14000000-0000-4000-8000-0000f150b010', 24)$q$),
      ('watchlist_items', 'watchlist_id', '18000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.watchlist_items (id, watchlist_id, video_id) VALUES ('18000000-0000-4000-8000-0000f150ff10', '17000000-0000-4000-8000-0000f150b010', '21000000-0000-4000-8000-0000f1500001')$q$),
      ('legal_acceptances', 'user_id', '19000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.legal_acceptances (id, user_id, document_kind, document_version, document_hash, locale, user_email_at_acceptance) VALUES ('19000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000b001', 'tos', '2026-10-11-1', 'hash-intruso', 'it', 'intruso@example.invalid')$q$),
      ('user_deletion_requests', 'user_id', '1a000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.user_deletion_requests (id, user_id, scheduled_deletion_at) VALUES ('1a000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000b001', NOW() + INTERVAL '1 day')$q$),
      ('jobs', 'created_by_user_id', '1c000000-0000-4000-8000-0000f150ff10',
       $q$INSERT INTO public.jobs (id, job_type, status, payload, created_by_user_id) VALUES ('1c000000-0000-4000-8000-0000f150ff10', 'sync_channel_delta', 'pending', '{}'::JSONB, '00000000-0000-4000-8000-00000000b001')$q$)
    ) AS spec(table_name, owner_col, probe_id, probe_sql)
  LOOP
    -- tentativo reale di inserimento: se la policy è permissiva la riga esiste e l'asserzione fallisce.
    PERFORM public.test_rls_can_write(v_spec.probe_sql);
    v_exists := public.test_rls_row_exists(v_spec.table_name, v_spec.probe_id::UUID);
    v_label := format('A non può inserire una riga di %s con ownership di B', v_spec.table_name);
    PERFORM public.test_assert_rls(NOT v_exists, v_label);
  END LOOP;

  -- UPDATE delle righe di B: la policy USING le rende invisibili, quindi nessuna riga cambia.
  PERFORM public.test_rls_can_write($q$UPDATE public.watchlists SET name = 'manomessa' WHERE id = '17000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.users SET display_name = 'manomesso' WHERE id = '00000000-0000-4000-8000-00000000b001'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.user_identities SET email = 'manomessa@example.invalid' WHERE id = '11000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.user_provider_credentials SET encrypted_key = 'manomessa' WHERE id = '12000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.user_channels SET is_active = FALSE WHERE id = '14000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.user_video_states SET seen_status = 'seen' WHERE id = '16000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.watchlist_items SET added_at = NOW() WHERE id = '18000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.user_deletion_requests SET status = 'cancelled' WHERE id = '1a000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.jobs SET status = 'completed' WHERE id = '1c000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.credential_checks SET is_valid = FALSE WHERE id = '13000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$UPDATE public.user_channel_preferences SET is_paused = TRUE WHERE id = '15000000-0000-4000-8000-0000f150b010'$q$);

  -- DELETE delle righe di B: nessuna riga eliminata.
  PERFORM public.test_rls_can_write($q$DELETE FROM public.watchlists WHERE id = '17000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.user_provider_credentials WHERE id = '12000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.user_video_states WHERE id = '16000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.user_channels WHERE id = '14000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.user_identities WHERE id = '11000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.watchlist_items WHERE id = '18000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.user_deletion_requests WHERE id = '1a000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.jobs WHERE id = '1c000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.credential_checks WHERE id = '13000000-0000-4000-8000-0000f150b010'$q$);
  PERFORM public.test_rls_can_write($q$DELETE FROM public.user_channel_preferences WHERE id = '15000000-0000-4000-8000-0000f150b010'$q$);
END;
$$;
RESET ROLE;

-- Verifica, come superuser, che nessuna scrittura di A abbia toccato lo stato di B.
SELECT public.test_assert_rls(
  (SELECT name = 'Watchlist B' FROM public.watchlists WHERE id = '17000000-0000-4000-8000-0000f150b010')
  AND (SELECT display_name = 'Utente B' FROM public.users WHERE id = '00000000-0000-4000-8000-00000000b001')
  AND (SELECT email = 'rls-b@example.invalid' FROM public.user_identities WHERE id = '11000000-0000-4000-8000-0000f150b010')
  AND (SELECT encrypted_key = 'cipher-rls-b' FROM public.user_provider_credentials WHERE id = '12000000-0000-4000-8000-0000f150b010')
  AND (SELECT is_active FROM public.user_channels WHERE id = '14000000-0000-4000-8000-0000f150b010')
  AND (SELECT seen_status = 'unseen' FROM public.user_video_states WHERE id = '16000000-0000-4000-8000-0000f150b010')
  AND (SELECT status = 'pending' FROM public.user_deletion_requests WHERE id = '1a000000-0000-4000-8000-0000f150b010')
  AND (SELECT status = 'pending' FROM public.jobs WHERE id = '1c000000-0000-4000-8000-0000f150b010')
  AND (SELECT is_valid FROM public.credential_checks WHERE id = '13000000-0000-4000-8000-0000f150b010')
  AND (SELECT is_paused = FALSE FROM public.user_channel_preferences WHERE id = '15000000-0000-4000-8000-0000f150b010'),
  'A non può aggiornare né cancellare le righe di B'
);

-- =========================================================================
-- 3. A non può cambiare il proprio status né riattivarsi se sospeso.
-- La policy "Users: update own" richiede `status = active` in USING e WITH CHECK.
-- =========================================================================
SET ROLE service_role;
UPDATE public.users SET status = 'suspended' WHERE id = '00000000-0000-4000-8000-00000000b001';
RESET ROLE;

SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000b001', 'B sospeso');
DO $$
BEGIN
  -- Sospeso: non può più leggere/aggiornare se stesso tramite la policy di update own.
  PERFORM public.test_rls_can_write($q$
    UPDATE public.users SET status = 'active' WHERE id = '00000000-0000-4000-8000-00000000b001'
  $q$);
END;
$$;
RESET ROLE;
SELECT public.test_assert_rls(
  (SELECT status = 'suspended' FROM public.users WHERE id = '00000000-0000-4000-8000-00000000b001'),
  'un utente sospeso non riesce a riattivarsi da solo'
);

-- A attivo prova a scrivere il proprio status (deve restare attivo ma non cambiato).
SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000a001', 'A attivo');
DO $$
BEGIN
  PERFORM public.test_rls_can_write($q$
    UPDATE public.users SET status = 'deleted' WHERE id = '00000000-0000-4000-8000-00000000a001'
  $q$);
END;
$$;
RESET ROLE;
SELECT public.test_assert_rls(
  (SELECT status = 'active' FROM public.users WHERE id = '00000000-0000-4000-8000-00000000a001'),
  'un utente attivo non può cambiare il proprio status via RLS'
);

-- =========================================================================
-- 4. Anonimo: nessuna lettura.
-- =========================================================================
SET ROLE anon;
DO $$
DECLARE
  v_can_read_rows BOOLEAN := FALSE;
  v_table TEXT;
  v_rows BIGINT;
BEGIN
  -- `anon` può avere il privilegio di tabella (baseline Supabase), ma nessuna policy
  -- gli è rivolta: deve quindi vedere zero righe su ogni tabella.
  FOR v_table IN
    SELECT t.relname FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relkind = 'r'
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_rows;
      IF v_rows > 0 THEN
        v_can_read_rows := TRUE;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
  PERFORM public.test_assert_rls(NOT v_can_read_rows, 'anon non legge alcuna riga delle tabelle di public');
END;
$$;
RESET ROLE;

-- =========================================================================
-- 5. Utente non super-admin: scrive solo dove è autorizzato; niente su canonico,
--    allowlist, audit, raw, job_attempts. `authenticated` non admin.
-- =========================================================================
SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000a001', 'A non admin');
DO $$
DECLARE
  v_can_write BOOLEAN;
BEGIN
  -- channels: solo admin scrive.
  v_can_write := public.test_rls_can_write($q$
    INSERT INTO public.channels (id, youtube_channel_id, title)
    VALUES ('20000000-0000-4000-8000-0000f150ff10', 'UC-utente', 'Canale utente')
  $q$);
  PERFORM public.test_assert_rls(
    NOT v_can_write OR NOT public.test_rls_row_exists('channels', '20000000-0000-4000-8000-0000f150ff10'),
    'un utente non admin non crea canali'
  );

  v_can_write := public.test_rls_can_write($q$
    UPDATE public.channels SET title = 'manomesso' WHERE id = '20000000-0000-4000-8000-0000f1500001'
  $q$);
  PERFORM public.test_assert_rls(
    (SELECT title = 'Canale RLS' FROM public.channels WHERE id = '20000000-0000-4000-8000-0000f1500001'),
    'un utente non admin non modifica i canali'
  );

  -- videos: solo admin scrive.
  PERFORM public.test_rls_can_write($q$
    INSERT INTO public.videos (id, channel_id, youtube_video_id, title, published_at, video_url)
    VALUES ('21000000-0000-4000-8000-0000f150ff10', '20000000-0000-4000-8000-0000f1500001', 'yt-utente', 'Video utente', NOW(), 'https://youtube.invalid/watch?v=yt-utente')
  $q$);
  PERFORM public.test_assert_rls(
    NOT public.test_rls_row_exists('videos', '21000000-0000-4000-8000-0000f150ff10'),
    'un utente non admin non crea video'
  );

  -- video_analysis / video_localized_content: solo admin scrive.
  PERFORM public.test_rls_can_write($q$
    INSERT INTO public.video_analysis (id, video_id) VALUES ('1e000000-0000-4000-8000-0000f150ff10', '21000000-0000-4000-8000-0000f1500001')
  $q$);
  PERFORM public.test_assert_rls(
    NOT public.test_rls_row_exists('video_analysis', '1e000000-0000-4000-8000-0000f150ff10'),
    'un utente non admin non crea analisi video'
  );
  PERFORM public.test_rls_can_write($q$
    INSERT INTO public.video_localized_content (id, video_analysis_id, video_id, language_code)
    VALUES ('22000000-0000-4000-8000-0000f150ff10', '1e000000-0000-4000-8000-0000f1500001', '21000000-0000-4000-8000-0000f1500001', 'it')
  $q$);
  PERFORM public.test_assert_rls(
    NOT public.test_rls_row_exists('video_localized_content', '22000000-0000-4000-8000-0000f150ff10'),
    'un utente non admin non crea contenuti localizzati'
  );

  -- allowlist_entries: solo admin (lettura e scrittura).
  PERFORM public.test_rls_can_write($q$
    INSERT INTO public.allowlist_entries (id, email) VALUES ('1d000000-0000-4000-8000-0000f150ff10', 'intruso@example.invalid')
  $q$);
  PERFORM public.test_assert_rls(
    NOT public.test_rls_row_exists('allowlist_entries', '1d000000-0000-4000-8000-0000f150ff10'),
    'un utente non admin non scrive in allowlist'
  );
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.allowlist_entries) = 0,
    'un utente non admin non legge la allowlist'
  );

  -- admin_actions_audit: solo admin.
  PERFORM public.test_rls_can_write($q$
    INSERT INTO public.admin_actions_audit (id, admin_user_id, action_type, target_type)
    VALUES ('20000000-0000-4000-8000-0000f150ff10', '00000000-0000-4000-8000-00000000a001', 'finto', 'finto')
  $q$);
  PERFORM public.test_assert_rls(
    NOT public.test_rls_row_exists('admin_actions_audit', '20000000-0000-4000-8000-0000f150ff10')
    AND (SELECT count(*) FROM public.admin_actions_audit) = 0,
    'un utente non admin non scrive né legge l audit admin'
  );

  -- video_analysis_raw: solo admin.
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.video_analysis_raw) = 0,
    'un utente non admin non legge il raw delle analisi'
  );

  -- job_attempts: solo admin.
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.job_attempts) = 0,
    'un utente non admin non legge gli attempt dei job'
  );
END;
$$;
RESET ROLE;

-- =========================================================================
-- 6. RLS attiva su ogni tabella di public, con le eccezioni esplicite.
-- Eccezioni elencate con motivo (nessuna oggi): tutte le tabelle di `public`
-- hanno RLS attiva perché le migrazioni la abilitano una per una.
-- =========================================================================
SELECT public.test_assert_rls(
  (SELECT count(*) FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity) = 0,
  'ogni tabella di public ha RLS attiva'
);
SELECT public.test_assert_rls(
  (SELECT count(*) FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r') > 0,
  'le tabelle di public esistono (query capace di fallire)'
);

-- =========================================================================
-- 7. Ogni funzione SECURITY DEFINER di public ha search_path fissato.
-- `proconfig` può essere 'search_path=""' o una lista esplicita, ma mai assente.
-- Sono esclusi i membri di estensioni (es. `dblink_connect_u` di dblink): non sono
-- codice del progetto e non possono essere modificati dalle migrazioni.
-- =========================================================================
SELECT public.test_assert_rls(
  (SELECT bool_and(
     p.proconfig IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
   )
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_depend d
       WHERE d.classid = 'pg_catalog.pg_proc'::regclass
         AND d.objid = p.oid
         AND d.deptype = 'e'
     )),
  'ogni funzione SECURITY DEFINER di public fissa search_path'
);
SELECT public.test_assert_rls(
  (SELECT count(*) > 0 FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_depend d
       WHERE d.classid = 'pg_catalog.pg_proc'::regclass
         AND d.objid = p.oid
         AND d.deptype = 'e'
     )),
  'esistono funzioni SECURITY DEFINER del progetto da controllare'
);

-- =========================================================================
-- 8. Le tre verifiche testuali di api-usage.test.ts, portate in SQL reale.
-- =========================================================================

-- 8a. Il provider Firecrawl è ammesso dalle CHECK reali (non dal testo della migrazione).
--     Si prova inserendo un record credenziale firecrawl (che funziona) e un evento ledger.
-- BUG: l'evento `api_usage_events` con provider `firecrawl` NON è inseribile. La migrazione
-- 20261012000000 sostituisce `api_usage_events_provider_check` (ora ammette 'firecrawl') ma
-- non aggiorna `api_usage_provider_fields_check`, che ammette solo youtube/gemini. L'app
-- costruisce per Firecrawl un evento con token/costi/quota tutti NULL, quindi la scrittura
-- viola il vincolo e il ledger perde l'evento. Il test che lo scopre resta commentato
-- (regola 6: il difetto non si corregge qui, si segnala).
SET ROLE service_role;
INSERT INTO public.user_provider_credentials (id, user_id, provider, encrypted_key, is_configured)
VALUES ('12000000-0000-4000-8000-0000f150c010', '00000000-0000-4000-8000-00000000c001', 'firecrawl', 'cipher-firecrawl', TRUE);
RESET ROLE;

SELECT public.test_assert_rls(
  (SELECT count(*) FROM public.user_provider_credentials WHERE provider = 'firecrawl') >= 1,
  'il provider Firecrawl è ammesso dalle CHECK reali sulle credenziali'
);

-- BUG: evento Firecrawl rifiutato da `api_usage_provider_fields_check` (20261004120000:23),
--      non aggiornato da 20261012000000. Da correggere in una migrazione dedicata.
-- SET ROLE service_role;
-- INSERT INTO public.api_usage_events (id, user_id, provider, operation, outcome) VALUES
--   ('1b000000-0000-4000-8000-0000f150c010', '00000000-0000-4000-8000-00000000c001', 'firecrawl', 'alexandria.find-tools', 'success');
-- RESET ROLE;
-- SELECT public.test_assert_rls(
--   (SELECT count(*) FROM public.api_usage_events WHERE provider = 'firecrawl') = 1,
--   'un evento Firecrawl è registrabile nel ledger'
-- );

-- 8b. Ownership e retention 30 giorni della policy sono provati leggendo da `authenticated`:
--     A vede il proprio evento recente ma non quello vecchio di oltre 30 giorni, né quelli di C.
SET ROLE service_role;
INSERT INTO public.api_usage_events (id, user_id, provider, operation, outcome, occurred_at) VALUES
  ('1b000000-0000-4000-8000-0000f150a020', '00000000-0000-4000-8000-00000000a001', 'youtube', 'videos.list', 'success', NOW() - INTERVAL '31 days');
RESET ROLE;

SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000c001', 'admin C');
DO $$
BEGIN
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.api_usage_events WHERE user_id = '00000000-0000-4000-8000-00000000a001') = 0,
    'un utente non legge gli eventi di un altro'
  );
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000a001', 'A');
DO $$
BEGIN
  -- A ha un evento recente e uno oltre i 30 giorni: solo il recente è visibile.
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.api_usage_events WHERE user_id = '00000000-0000-4000-8000-00000000a001') = 1,
    'la retention di 30 giorni nasconde gli eventi più vecchi'
  );
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.api_usage_events WHERE id = '1b000000-0000-4000-8000-0000f150a020') = 0,
    'un evento oltre 30 giorni non è leggibile'
  );
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.api_usage_events WHERE user_id = '00000000-0000-4000-8000-00000000c001') = 0,
    'A non vede gli eventi di C'
  );
END;
$$;
RESET ROLE;

-- 8c. La RPC summary lascia ignoto (NULL) ciò che è ignoto, non lo trasforma in zero.
--     Un evento con i metadati tutti NULL e uno senza: il risultato deve restare NULL,
--     tranne quota_units per YouTube.
SET ROLE service_role;
INSERT INTO public.api_usage_events (id, user_id, provider, operation, outcome) VALUES
  ('1b000000-0000-4000-8000-0000f150b020', '00000000-0000-4000-8000-00000000b001', 'gemini', 'generateContent', 'http_error');
RESET ROLE;

SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000b001', 'B');
DO $$
DECLARE
  v_sum RECORD;
BEGIN
  SELECT * INTO v_sum FROM public.get_my_api_usage_summary(NOW() - INTERVAL '30 days') WHERE provider = 'gemini';
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS assertion failed: RPC summary senza riga per B'; END IF;
  PERFORM public.test_assert_rls(
    v_sum.request_count = 1
    AND v_sum.input_tokens IS NULL
    AND v_sum.output_tokens IS NULL
    AND v_sum.total_tokens IS NULL
    AND v_sum.estimated_cost_usd IS NULL,
    'la RPC summary lascia NULL gli aggregati ignoti invece di azzerarli'
  );
  PERFORM public.test_assert_rls(
    v_sum.unknown_usage_count = 1,
    'la RPC summary conteggia l evento senza metadati d uso'
  );
END;
$$;
RESET ROLE;

-- La RPC non vede eventi di altri utenti (è SECURITY INVOKER e filtra auth.uid()).
SET ROLE authenticated;
SELECT public.test_rls_scope('00000000-0000-4000-8000-00000000a001', 'A');
DO $$
BEGIN
  PERFORM public.test_assert_rls(
    (SELECT count(*) FROM public.get_my_api_usage_summary(NOW() - INTERVAL '30 days') WHERE provider = 'gemini') = 0,
    'la RPC summary applica l ownership e non aggrega gli eventi di altri utenti'
  );
END;
$$;
RESET ROLE;

-- =========================================================================
-- Pulizia: rimuovere i dati RLS così il database resta ripulito e riutilizzabile.
-- =========================================================================
SET ROLE service_role;
DELETE FROM public.user_deletion_requests WHERE id IN ('1a000000-0000-4000-8000-0000f150a010', '1a000000-0000-4000-8000-0000f150b010');
DELETE FROM public.user_roles WHERE user_id IN ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000c001');
DELETE FROM public.user_identities WHERE id IN ('11000000-0000-4000-8000-0000f150a010', '11000000-0000-4000-8000-0000f150b010');
DELETE FROM public.credential_checks WHERE id IN ('13000000-0000-4000-8000-0000f150a010', '13000000-0000-4000-8000-0000f150b010');
DELETE FROM public.user_provider_credentials WHERE id IN ('12000000-0000-4000-8000-0000f150a010', '12000000-0000-4000-8000-0000f150b010', '12000000-0000-4000-8000-0000f150c010');
DELETE FROM public.user_channel_preferences WHERE id IN ('15000000-0000-4000-8000-0000f150a010', '15000000-0000-4000-8000-0000f150b010');
DELETE FROM public.watchlist_items WHERE id IN ('18000000-0000-4000-8000-0000f150a010', '18000000-0000-4000-8000-0000f150b010');
DELETE FROM public.watchlists WHERE id IN ('17000000-0000-4000-8000-0000f150a010', '17000000-0000-4000-8000-0000f150b010');
DELETE FROM public.user_video_states WHERE id IN ('16000000-0000-4000-8000-0000f150a010', '16000000-0000-4000-8000-0000f150b010');
DELETE FROM public.user_channels WHERE id IN ('14000000-0000-4000-8000-0000f150a010', '14000000-0000-4000-8000-0000f150b010');
DELETE FROM public.legal_acceptances WHERE id IN ('19000000-0000-4000-8000-0000f150a010', '19000000-0000-4000-8000-0000f150b010');
DELETE FROM public.api_usage_events WHERE id IN ('1b000000-0000-4000-8000-0000f150a010', '1b000000-0000-4000-8000-0000f150a020', '1b000000-0000-4000-8000-0000f150b010', '1b000000-0000-4000-8000-0000f150b020', '1b000000-0000-4000-8000-0000f150c010');
DELETE FROM public.job_attempts WHERE id = '21000000-0000-4000-8000-0000f150a010';
DELETE FROM public.jobs WHERE id IN ('1c000000-0000-4000-8000-0000f150a010', '1c000000-0000-4000-8000-0000f150b010');
DELETE FROM public.video_analysis_raw WHERE id = '1f000000-0000-4000-8000-0000f1500001';
DELETE FROM public.video_analysis WHERE id = '1e000000-0000-4000-8000-0000f1500001';
DELETE FROM public.allowlist_entries WHERE id = '1d000000-0000-4000-8000-0000f1500001';
DELETE FROM public.admin_actions_audit WHERE id = '20000000-0000-4000-8000-0000f150c010';
DELETE FROM public.videos WHERE id = '21000000-0000-4000-8000-0000f1500001';
DELETE FROM public.channels WHERE id = '20000000-0000-4000-8000-0000f1500001';
DELETE FROM public.users WHERE id IN ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000c001');
DELETE FROM auth.users WHERE id IN ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000c001');
RESET ROLE;

DROP FUNCTION public.test_rls_can_write(TEXT);
DROP FUNCTION public.test_rls_row_exists(TEXT, UUID);
DROP FUNCTION public.test_rls_scope(UUID, TEXT);
DROP FUNCTION public.test_assert_rls(BOOLEAN, TEXT);

SELECT 'POSTGRES REAL MIGRATION/RPC TESTS PASS' AS result;