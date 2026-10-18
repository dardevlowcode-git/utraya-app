-- Esegue RPC e migrazioni reali contro PostgreSQL effimero; i dati sono solo fixture sintetiche.
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE FUNCTION public.test_assert_true(p_condition BOOLEAN, p_label TEXT) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'assertion failed: %', p_label;
  END IF;
END;
$$;

SELECT public.test_assert_true(
  (SELECT retry_limit = 0 FROM public.user_provider_credential_retry_limits
   WHERE credential_id = '10000000-0000-4000-8000-000000000001'),
  'la migration assegna retry_limit 0 alle credenziali preesistenti'
);
SELECT public.test_assert_true(
  (SELECT retry_limit = 10 FROM public.shared_provider_retry_settings
   WHERE provider_key = 'youtube_innertube'),
  'il limite YouTube condiviso resta 10'
);
SELECT public.test_assert_true(
  (SELECT enabled = FALSE FROM public.firecrawl_transcript_recovery_settings WHERE id = TRUE),
  'il gate Firecrawl nasce chiuso'
);
SELECT public.test_assert_true(
  NOT has_function_privilege('authenticated', 'public.save_user_provider_credential_atomic(uuid,uuid,text,text,text,uuid,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.save_user_provider_credential_atomic(uuid,uuid,text,text,text,uuid,boolean)', 'EXECUTE')
  AND has_table_privilege('service_role', 'public.jobs', 'UPDATE')
  AND has_function_privilege('service_role', 'public.claim_scan_job_with_attempt(uuid,timestamptz,uuid,timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.finish_scan_job_attempt(uuid,uuid,uuid,text,timestamptz,text,jsonb)', 'EXECUTE')
  AND (SELECT rolbypassrls AND NOT rolsuper FROM pg_catalog.pg_roles WHERE rolname = 'service_role'),
  'service_role non superuser possiede gli EXECUTE e i privilegi effettivi richiesti'
);

SELECT public.test_assert_true(
  has_function_privilege('service_role', 'public.commit_fenced_channel_import(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,integer)', 'EXECUTE'),
  'commit_fenced_channel_import resta eseguibile da service_role'
);
SELECT public.test_assert_true(
  (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.commit_fenced_channel_import(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,integer)'::regprocedure),
  'commit_fenced_channel_import resta SECURITY DEFINER'
);
SELECT public.test_assert_true(
  (SELECT pg_catalog.array_to_string(p.proconfig, ',') = 'search_path=""' FROM pg_catalog.pg_proc p WHERE p.oid = 'public.commit_fenced_channel_import(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,integer)'::regprocedure),
  'commit_fenced_channel_import mantiene search_path vuoto'
);

INSERT INTO public.channels (id, youtube_channel_id, title) VALUES
  ('20000000-0000-4000-8000-000000000001', 'UC-rotation', 'Rotation channel'),
  ('20000000-0000-4000-8000-000000000002', 'UC-revocation', 'Revocation channel'),
  ('20000000-0000-4000-8000-000000000003', 'UC-version', 'Version channel'),
  ('20000000-0000-4000-8000-000000000004', 'UC-canonical', 'Canonical channel');

INSERT INTO public.user_provider_credentials (id, user_id, provider, encrypted_key, is_configured) VALUES
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'youtube', 'cipher-owner-b', TRUE),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'firecrawl', 'cipher-firecrawl', TRUE),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'gemini', 'cipher-gemini', TRUE);

INSERT INTO public.user_channels (user_id, channel_id, is_active, added_at) VALUES
  ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', TRUE, '2020-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', TRUE, '2021-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', TRUE, '2020-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', TRUE, '2021-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', TRUE, '2020-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', TRUE, '2020-01-01T00:00:00Z');

-- L'import canonico non crea placeholder transcript né target di recupero (gate storico chiuso).
INSERT INTO public.jobs (id, job_type, status, payload, lease_id, lease_expires_at)
VALUES (
  '30000000-0000-4000-8000-000000000008', 'sync_channel_delta', 'running',
  jsonb_build_object('channelId', '20000000-0000-4000-8000-000000000004'),
  '50000000-0000-4000-8000-000000000031', clock_timestamp() + INTERVAL '5 minutes'
);
SET ROLE service_role;
DO $$
BEGIN
  PERFORM public.commit_fenced_channel_import(
    '30000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004',
    'UC-canonical', 'Canonical channel', '@canonical', '{}'::JSONB,
    '[{"youtube_video_id":"yt-new-gate-off","title":"New gated video","published_at":"2026-01-02T00:00:00Z","video_url":"https://youtube.invalid/watch?v=yt-new-gate-off","video_type":"standard","availability_status":"available"}]'::JSONB,
    'success', 1
  );
  IF EXISTS (SELECT 1 FROM public.video_transcripts WHERE youtube_video_id = 'yt-new-gate-off') THEN
    RAISE EXCEPTION 'import_created_legacy_transcript_placeholder';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channel_scan_firecrawl_transcript_targets WHERE youtube_video_id = 'yt-new-gate-off') THEN
    RAISE EXCEPTION 'import_created_recovery_target';
  END IF;
END;
$$;
RESET ROLE;

-- Atomic replacement: force a failure after retry metadata was reset, then prove rollback preserves every old state.
UPDATE public.user_provider_credential_retry_limits
SET retry_limit = 7, key_version = '40000000-0000-4000-8000-000000000001'
WHERE credential_id = '10000000-0000-4000-8000-000000000001';

INSERT INTO public.jobs (id, job_type, status, payload, next_attempt_at)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  'validate_provider_credential',
  'pending',
  jsonb_build_object(
    'credentialId', '10000000-0000-4000-8000-000000000001',
    'userId', '00000000-0000-4000-8000-000000000001',
    'provider', 'youtube',
    'keyVersion', '40000000-0000-4000-8000-000000000001',
    'retryLimit', 7
  ),
  clock_timestamp()
);

CREATE FUNCTION public.test_reject_credential_replacement() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.encrypted_key = 'cipher-replacement-failure' THEN
    RAISE EXCEPTION 'forced_atomic_replacement_failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_reject_credential_replacement
  BEFORE UPDATE ON public.user_provider_credentials
  FOR EACH ROW EXECUTE FUNCTION public.test_reject_credential_replacement();

SET ROLE service_role;
DO $$
DECLARE
  v_save RECORD;
BEGIN
  BEGIN
    SELECT * INTO v_save FROM public.save_user_provider_credential_atomic(
      '10000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      'youtube',
      'cipher-replacement-failure',
      'cipher-old',
      '40000000-0000-4000-8000-000000000001',
      TRUE
    );
    RAISE EXCEPTION 'test_expected_replacement_failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'test_expected_replacement_failure' THEN RAISE; END IF;
    IF SQLERRM <> 'forced_atomic_replacement_failure' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

SELECT public.test_assert_true(
  (SELECT encrypted_key = 'cipher-old' FROM public.user_provider_credentials
   WHERE id = '10000000-0000-4000-8000-000000000001'),
  'se il salvataggio fallisce, la chiave vecchia resta invariata'
);
SELECT public.test_assert_true(
  (SELECT retry_limit = 7 AND key_version = '40000000-0000-4000-8000-000000000001'
   FROM public.user_provider_credential_retry_limits
   WHERE credential_id = '10000000-0000-4000-8000-000000000001'),
  'se il salvataggio fallisce, override e key-version restano invariati'
);
SELECT public.test_assert_true(
  (SELECT status = 'pending' FROM public.jobs WHERE id = '30000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.job_attempts WHERE job_id = '30000000-0000-4000-8000-000000000001'),
  'se il salvataggio fallisce, il job e i suoi attempt non cambiano'
);

DROP TRIGGER test_reject_credential_replacement ON public.user_provider_credentials;
DROP FUNCTION public.test_reject_credential_replacement();

SET ROLE service_role;
DO $$
DECLARE
  v_old_version UUID := '40000000-0000-4000-8000-000000000001';
  v_new_version UUID;
  v_claim_count INTEGER;
  v_save RECORD;
BEGIN
  SELECT * INTO v_save FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'youtube',
    'cipher-replacement-success',
    'cipher-old',
    v_old_version,
    TRUE
  );
  IF v_save.status <> 'saved' THEN RAISE EXCEPTION 'initial_atomic_replacement_not_saved'; END IF;
  SELECT key_version INTO v_new_version FROM public.user_provider_credential_retry_limits
    WHERE credential_id = '10000000-0000-4000-8000-000000000001';
  IF v_new_version = v_old_version THEN RAISE EXCEPTION 'replacement_did_not_rotate_key_version'; END IF;
  IF (SELECT retry_limit FROM public.user_provider_credential_retry_limits
      WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'replacement_did_not_reset_retry_limit';
  END IF;
  IF (SELECT encrypted_key FROM public.user_provider_credentials
      WHERE id = '10000000-0000-4000-8000-000000000001') <> 'cipher-replacement-success' THEN
    RAISE EXCEPTION 'replacement_secret_not_written';
  END IF;

  SELECT count(*) INTO v_claim_count
  FROM public.claim_credential_validation_job_with_attempt(
    '30000000-0000-4000-8000-000000000001', clock_timestamp(),
    '50000000-0000-4000-8000-000000000001', clock_timestamp() + INTERVAL '1 minute'
  );
  IF v_claim_count <> 0 THEN RAISE EXCEPTION 'stale_key_version_was_claimed'; END IF;
  IF (SELECT status FROM public.jobs WHERE id = '30000000-0000-4000-8000-000000000001') <> 'failed'
     OR (SELECT error_message FROM public.jobs WHERE id = '30000000-0000-4000-8000-000000000001') <> 'credential_changed' THEN
    RAISE EXCEPTION 'stale_validation_job_not_fenced';
  END IF;
END;
$$;
RESET ROLE;

-- Stale CAS conflicts preserve the newer key; the caller can recompute same-secret vs replacement safely.
SET ROLE service_role;
DO $$
DECLARE
  v_cipher TEXT;
  v_version UUID;
  v_version_after UUID;
  v_retry_limit INTEGER;
  v_result RECORD;
BEGIN
  SELECT credential.encrypted_key, retry.key_version
  INTO v_cipher, v_version
  FROM public.user_provider_credentials AS credential
  JOIN public.user_provider_credential_retry_limits AS retry ON retry.credential_id = credential.id
  WHERE credential.id = '10000000-0000-4000-8000-000000000001';

  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-different-a', v_cipher, v_version, TRUE
  );
  IF v_result.status <> 'saved' THEN RAISE EXCEPTION 'first_concurrent_replacement_not_saved'; END IF;
  SELECT retry.key_version INTO v_version_after FROM public.user_provider_credential_retry_limits AS retry
    WHERE retry.credential_id = '10000000-0000-4000-8000-000000000001';

  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-different-b', v_cipher, v_version, TRUE
  );
  IF v_result.status <> 'conflict' THEN RAISE EXCEPTION 'stale_different_secret_cas_was_not_rejected'; END IF;
  IF (SELECT encrypted_key FROM public.user_provider_credentials WHERE id = '10000000-0000-4000-8000-000000000001') <> 'cipher-different-a'
     OR (SELECT retry_limit FROM public.user_provider_credential_retry_limits WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> 0
     OR (SELECT key_version FROM public.user_provider_credential_retry_limits WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> v_version_after THEN
    RAISE EXCEPTION 'stale_different_secret_changed_committed_state';
  END IF;

  -- Simulate an admin override committed after the service read but before a same-secret CAS.
  SELECT encrypted_key, key_version INTO v_cipher, v_version
  FROM public.user_provider_credentials AS credential
  JOIN public.user_provider_credential_retry_limits AS retry ON retry.credential_id = credential.id
  WHERE credential.id = '10000000-0000-4000-8000-000000000001';
  UPDATE public.user_provider_credential_retry_limits SET retry_limit = 11
    WHERE credential_id = '10000000-0000-4000-8000-000000000001';
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-same-one', v_cipher, v_version, FALSE
  );
  IF v_result.status <> 'saved'
     OR (SELECT retry_limit FROM public.user_provider_credential_retry_limits WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> 11
     OR (SELECT key_version FROM public.user_provider_credential_retry_limits WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> v_version THEN
    RAISE EXCEPTION 'same_secret_save_overwrote_admin_override';
  END IF;

  -- Two resaves of the same cleartext can CAS-conflict after nonce/ciphertext rotation; retrying with the latest snapshot preserves the override.
  SELECT credential.encrypted_key, retry.key_version INTO v_cipher, v_version
  FROM public.user_provider_credentials AS credential
  JOIN public.user_provider_credential_retry_limits AS retry ON retry.credential_id = credential.id
  WHERE credential.id = '10000000-0000-4000-8000-000000000001';
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-same-two', v_cipher, v_version, FALSE
  );
  IF v_result.status <> 'saved' THEN RAISE EXCEPTION 'first_same_secret_cas_not_saved'; END IF;
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-same-three', v_cipher, v_version, FALSE
  );
  IF v_result.status <> 'conflict' THEN RAISE EXCEPTION 'stale_same_secret_cas_was_not_rejected'; END IF;
  SELECT encrypted_key INTO v_cipher FROM public.user_provider_credentials
    WHERE id = '10000000-0000-4000-8000-000000000001';
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-same-three', v_cipher, v_version, FALSE
  );
  IF v_result.status <> 'saved'
     OR (SELECT retry_limit FROM public.user_provider_credential_retry_limits WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> 11
     OR (SELECT key_version FROM public.user_provider_credential_retry_limits WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> v_version THEN
    RAISE EXCEPTION 'same_secret_cas_retry_lost_admin_override';
  END IF;

  -- A stale same-secret request cannot restore its old cleartext after a different secret has won.
  SELECT credential.encrypted_key, retry.key_version INTO v_cipher, v_version
  FROM public.user_provider_credentials AS credential
  JOIN public.user_provider_credential_retry_limits AS retry ON retry.credential_id = credential.id
  WHERE credential.id = '10000000-0000-4000-8000-000000000001';
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-different-c', v_cipher, v_version, TRUE
  );
  IF v_result.status <> 'saved' THEN RAISE EXCEPTION 'intervening_replacement_not_saved'; END IF;
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-old-same-secret-request', v_cipher, v_version, FALSE
  );
  IF v_result.status <> 'conflict'
     OR (SELECT encrypted_key FROM public.user_provider_credentials WHERE id = '10000000-0000-4000-8000-000000000001') <> 'cipher-different-c' THEN
    RAISE EXCEPTION 'stale_same_secret_request_overwrote_new_secret';
  END IF;
  SELECT encrypted_key, key_version INTO v_cipher, v_version
  FROM public.user_provider_credentials AS credential
  JOIN public.user_provider_credential_retry_limits AS retry ON retry.credential_id = credential.id
  WHERE credential.id = '10000000-0000-4000-8000-000000000001';
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
    'youtube', 'cipher-old-same-secret-request', v_cipher, v_version, TRUE
  );
  IF v_result.status <> 'saved'
     OR (SELECT retry_limit FROM public.user_provider_credential_retry_limits WHERE credential_id = '10000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'replacement_retry_after_cas_conflict_not_reset';
  END IF;
END;
$$;
RESET ROLE;

-- Two first writes serialize on the unique owner/provider key; the loser retries from the committed row.
SET ROLE service_role;
DO $$
DECLARE
  v_result RECORD;
  v_credential_id UUID;
  v_key_version UUID;
BEGIN
  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    NULL, '00000000-0000-4000-8000-000000000002', 'gemini',
    'cipher-first-insert', NULL, NULL, FALSE
  );
  IF v_result.status <> 'saved' OR v_result.retry_limit <> 0 THEN RAISE EXCEPTION 'first_insert_not_defaulted'; END IF;
  v_credential_id := v_result.credential_id;
  v_key_version := v_result.key_version;

  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    NULL, '00000000-0000-4000-8000-000000000002', 'gemini',
    'cipher-racing-insert', NULL, NULL, FALSE
  );
  IF v_result.status <> 'conflict' THEN RAISE EXCEPTION 'concurrent_initial_insert_was_not_cas_conflict'; END IF;
  IF (SELECT encrypted_key FROM public.user_provider_credentials WHERE id = v_credential_id) <> 'cipher-first-insert'
     OR (SELECT key_version FROM public.user_provider_credential_retry_limits WHERE credential_id = v_credential_id) <> v_key_version THEN
    RAISE EXCEPTION 'racing_initial_insert_overwrote_current_credential';
  END IF;

  SELECT * INTO v_result FROM public.save_user_provider_credential_atomic(
    v_credential_id, '00000000-0000-4000-8000-000000000002', 'gemini',
    'cipher-racing-insert', 'cipher-first-insert', v_key_version, TRUE
  );
  IF v_result.status <> 'saved' OR v_result.retry_limit <> 0 OR v_result.key_version = v_key_version THEN
    RAISE EXCEPTION 'retry_after_initial_insert_conflict_failed';
  END IF;
END;
$$;
RESET ROLE;

-- Concurrent validation claims serialize on the job row: only one worker receives the lease.
INSERT INTO public.jobs (id, job_type, status, payload, next_attempt_at)
VALUES (
  '30000000-0000-4000-8000-000000000002',
  'validate_provider_credential',
  'pending',
  jsonb_build_object(
    'credentialId', '10000000-0000-4000-8000-000000000002',
    'userId', '00000000-0000-4000-8000-000000000002',
    'provider', 'youtube',
    'keyVersion', (SELECT key_version::TEXT FROM public.user_provider_credential_retry_limits
                   WHERE credential_id = '10000000-0000-4000-8000-000000000002'),
    'retryLimit', 0
  ),
  clock_timestamp()
);

-- Concurrent scan-job claims are also fenced to one lease.
INSERT INTO public.jobs (id, job_type, status, payload)
VALUES (
  '30000000-0000-4000-8000-000000000007',
  'sync_channel_delta',
  'pending',
  jsonb_build_object('channelId', '20000000-0000-4000-8000-000000000001')
);

CREATE FUNCTION public.test_pause_concurrent_job_claim() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'running'
     AND OLD.id IN ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000007') THEN
    PERFORM pg_catalog.pg_sleep(0.4);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_pause_concurrent_job_claim
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.test_pause_concurrent_job_claim();

CREATE TEMP TABLE claim_race (
  worker TEXT,
  job_id UUID,
  lease_id UUID,
  attempt_id UUID,
  attempt_number BIGINT,
  payload JSONB
);

SELECT dblink_connect('claim_a', 'dbname=postgres user=service_role host=127.0.0.1');
SELECT dblink_connect('claim_b', 'dbname=postgres user=service_role host=127.0.0.1');
SELECT dblink_send_query('claim_a', $q$
  SELECT job_id, lease_id, attempt_id, attempt_number, payload
  FROM public.claim_credential_validation_job_with_attempt(
    '30000000-0000-4000-8000-000000000002', clock_timestamp(),
    '50000000-0000-4000-8000-000000000002', clock_timestamp() + INTERVAL '1 minute')
$q$);
SELECT dblink_send_query('claim_b', $q$
  SELECT job_id, lease_id, attempt_id, attempt_number, payload
  FROM public.claim_credential_validation_job_with_attempt(
    '30000000-0000-4000-8000-000000000002', clock_timestamp(),
    '50000000-0000-4000-8000-000000000003', clock_timestamp() + INTERVAL '1 minute')
$q$);
INSERT INTO claim_race
SELECT 'validation-a', result.*
FROM dblink_get_result('claim_a') AS result(job_id UUID, lease_id UUID, attempt_id UUID, attempt_number BIGINT, payload JSONB);
INSERT INTO claim_race
SELECT 'validation-b', result.*
FROM dblink_get_result('claim_b') AS result(job_id UUID, lease_id UUID, attempt_id UUID, attempt_number BIGINT, payload JSONB);
SELECT public.test_assert_true(
  (SELECT count(*) = 1 FROM claim_race WHERE job_id = '30000000-0000-4000-8000-000000000002'),
  'claim concorrenti della validazione producono una sola lease e un solo attempt'
);
SELECT dblink_disconnect('claim_a');
SELECT dblink_disconnect('claim_b');

SELECT dblink_connect('claim_a', 'dbname=postgres user=service_role host=127.0.0.1');
SELECT dblink_connect('claim_b', 'dbname=postgres user=service_role host=127.0.0.1');
SELECT dblink_send_query('claim_a', $q$
  SELECT job_id, lease_id, attempt_id, attempt_number, NULL::JSONB
  FROM public.claim_scan_job_with_attempt(
    '30000000-0000-4000-8000-000000000007', clock_timestamp(),
    '50000000-0000-4000-8000-000000000007', clock_timestamp() + INTERVAL '1 minute')
$q$);
SELECT dblink_send_query('claim_b', $q$
  SELECT job_id, lease_id, attempt_id, attempt_number, NULL::JSONB
  FROM public.claim_scan_job_with_attempt(
    '30000000-0000-4000-8000-000000000007', clock_timestamp(),
    '50000000-0000-4000-8000-000000000008', clock_timestamp() + INTERVAL '1 minute')
$q$);
INSERT INTO claim_race
SELECT 'scan-a', result.*
FROM dblink_get_result('claim_a') AS result(job_id UUID, lease_id UUID, attempt_id UUID, attempt_number BIGINT, payload JSONB);
INSERT INTO claim_race
SELECT 'scan-b', result.*
FROM dblink_get_result('claim_b') AS result(job_id UUID, lease_id UUID, attempt_id UUID, attempt_number BIGINT, payload JSONB);
SELECT public.test_assert_true(
  (SELECT count(*) = 1 FROM claim_race WHERE job_id = '30000000-0000-4000-8000-000000000007'),
  'claim concorrenti di scan producono una sola lease e un solo attempt'
);
SELECT dblink_disconnect('claim_a');
SELECT dblink_disconnect('claim_b');
DROP TRIGGER test_pause_concurrent_job_claim ON public.jobs;
DROP FUNCTION public.test_pause_concurrent_job_claim();

-- Contesa reale fra job distinti sul cursore condiviso (channel, provider): ciascuno riceve un follower diverso.
INSERT INTO public.jobs (id, job_type, status, payload, lease_id, lease_expires_at) VALUES
  ('30000000-0000-4000-8000-000000000009', 'sync_channel_delta', 'running',
   jsonb_build_object('channelId', '20000000-0000-4000-8000-000000000001'),
   '50000000-0000-4000-8000-000000000040', clock_timestamp() + INTERVAL '5 minutes'),
  ('30000000-0000-4000-8000-00000000000a', 'sync_channel_delta', 'running',
   jsonb_build_object('channelId', '20000000-0000-4000-8000-000000000001'),
   '50000000-0000-4000-8000-000000000041', clock_timestamp() + INTERVAL '5 minutes');
CREATE FUNCTION public.test_pause_channel_provider_cursor() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.channel_id = '20000000-0000-4000-8000-000000000001' AND NEW.provider = 'youtube' THEN
    PERFORM pg_catalog.pg_sleep(0.4);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_pause_channel_provider_cursor
  BEFORE UPDATE ON public.channel_scan_key_rotation_cursors
  FOR EACH ROW EXECUTE FUNCTION public.test_pause_channel_provider_cursor();
CREATE TEMP TABLE cursor_claim_race (
  worker TEXT,
  status TEXT,
  credential_id UUID,
  user_id UUID,
  key_version UUID,
  retry_limit INTEGER,
  attempt_number BIGINT,
  retry_at TIMESTAMPTZ,
  response JSONB
);
SELECT dblink_connect('cursor_a', 'dbname=postgres user=service_role host=127.0.0.1');
SELECT dblink_connect('cursor_b', 'dbname=postgres user=service_role host=127.0.0.1');
SELECT dblink_send_query('cursor_a', $q$
  SELECT status, credential_id, user_id, key_version, retry_limit, attempt_number, retry_at, response
  FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000040',
    '20000000-0000-4000-8000-000000000001', repeat('e', 64), 'youtube')
$q$);
SELECT dblink_send_query('cursor_b', $q$
  SELECT status, credential_id, user_id, key_version, retry_limit, attempt_number, retry_at, response
  FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-000000000041',
    '20000000-0000-4000-8000-000000000001', repeat('f', 64), 'youtube')
$q$);
INSERT INTO cursor_claim_race
SELECT 'job-a', result.* FROM dblink_get_result('cursor_a') AS result(
  status TEXT, credential_id UUID, user_id UUID, key_version UUID, retry_limit INTEGER,
  attempt_number BIGINT, retry_at TIMESTAMPTZ, response JSONB);
INSERT INTO cursor_claim_race
SELECT 'job-b', result.* FROM dblink_get_result('cursor_b') AS result(
  status TEXT, credential_id UUID, user_id UUID, key_version UUID, retry_limit INTEGER,
  attempt_number BIGINT, retry_at TIMESTAMPTZ, response JSONB);
SELECT dblink_disconnect('cursor_a');
SELECT dblink_disconnect('cursor_b');
SELECT public.test_assert_true(
  (SELECT count(*) = 2 AND count(DISTINCT user_id) = 2 AND bool_and(status = 'assigned')
   FROM cursor_claim_race),
  'job distinti contesi sul cursore channel/provider ricevono follower diversi'
);
DROP TRIGGER test_pause_channel_provider_cursor ON public.channel_scan_key_rotation_cursors;
DROP FUNCTION public.test_pause_channel_provider_cursor();

-- Il budget 1 consente due richieste: la lease scaduta consuma la seconda e il recovery non la riapre.
UPDATE public.user_provider_credential_retry_limits
SET retry_limit = 1, key_version = '40000000-0000-4000-8000-000000000004'
WHERE credential_id = '10000000-0000-4000-8000-000000000004';
INSERT INTO public.jobs (id, job_type, status, payload, next_attempt_at)
VALUES (
  '30000000-0000-4000-8000-000000000003',
  'validate_provider_credential',
  'pending',
  jsonb_build_object(
    'credentialId', '10000000-0000-4000-8000-000000000004',
    'userId', '00000000-0000-4000-8000-000000000001',
    'provider', 'gemini',
    'keyVersion', '40000000-0000-4000-8000-000000000004',
    'retryLimit', 1
  ),
  clock_timestamp()
);

SET ROLE service_role;
DO $$
DECLARE
  v_first RECORD;
  v_second RECORD;
  v_claim_count INTEGER;
  v_completed_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_first FROM public.claim_credential_validation_job_with_attempt(
    '30000000-0000-4000-8000-000000000003', clock_timestamp(),
    '50000000-0000-4000-8000-000000000010', clock_timestamp() + INTERVAL '1 minute'
  );
  IF v_first.attempt_number <> 1 THEN RAISE EXCEPTION 'initial_validation_attempt_not_one'; END IF;

  v_completed_at := clock_timestamp();
  IF NOT public.finish_credential_validation_job_attempt(
    '30000000-0000-4000-8000-000000000003', v_first.lease_id, v_first.attempt_id,
    v_first.attempt_number, 1, 'pending', v_completed_at, v_completed_at + INTERVAL '1 second',
    FALSE, 'temporary provider failure', 'temporary', FALSE
  ) THEN RAISE EXCEPTION 'first_validation_attempt_not_finished'; END IF;

  IF public.finish_credential_validation_job_attempt(
    '30000000-0000-4000-8000-000000000003', v_first.lease_id, v_first.attempt_id,
    v_first.attempt_number, 1, 'completed', clock_timestamp(), NULL, TRUE, NULL, NULL, FALSE
  ) THEN RAISE EXCEPTION 'stale_validation_lease_was_accepted'; END IF;

  UPDATE public.jobs SET next_attempt_at = clock_timestamp() - INTERVAL '1 second'
  WHERE id = '30000000-0000-4000-8000-000000000003';
  SELECT * INTO v_second FROM public.claim_credential_validation_job_with_attempt(
    '30000000-0000-4000-8000-000000000003', clock_timestamp(),
    '50000000-0000-4000-8000-000000000011', clock_timestamp() + INTERVAL '1 minute'
  );
  IF v_second.attempt_number <> 2 THEN RAISE EXCEPTION 'retry_budget_one_did_not_allow_second_attempt'; END IF;

  UPDATE public.jobs SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
  WHERE id = '30000000-0000-4000-8000-000000000003';
  SELECT count(*) INTO v_claim_count FROM public.claim_credential_validation_job_with_attempt(
    '30000000-0000-4000-8000-000000000003', clock_timestamp(),
    '50000000-0000-4000-8000-000000000012', clock_timestamp() + INTERVAL '1 minute'
  );
  IF v_claim_count <> 0 THEN RAISE EXCEPTION 'expired_attempt_reopened_exhausted_budget'; END IF;
  IF (SELECT count(*) FROM public.job_attempts WHERE job_id = '30000000-0000-4000-8000-000000000003') <> 2 THEN
    RAISE EXCEPTION 'lease_recovery_changed_attempt_budget';
  END IF;
  IF (SELECT status FROM public.jobs WHERE id = '30000000-0000-4000-8000-000000000003') <> 'failed'
     OR (SELECT error_message FROM public.jobs WHERE id = '30000000-0000-4000-8000-000000000003') <> 'validation_retry_budget_exhausted' THEN
    RAISE EXCEPTION 'exhausted_validation_job_not_terminal';
  END IF;
  IF (SELECT count(*) FROM public.credential_checks WHERE credential_id = '10000000-0000-4000-8000-000000000004') <> 1 THEN
    RAISE EXCEPTION 'exhausted_validation_not_audited';
  END IF;
END;
$$;
RESET ROLE;

-- Round-robin, same-key retry/backoff, failover and terminal stop are exercised by actual channel-scan RPCs.
UPDATE public.user_provider_credential_retry_limits
SET retry_limit = 1
WHERE credential_id = '10000000-0000-4000-8000-000000000001';
INSERT INTO public.jobs (id, job_type, status, payload, lease_id, lease_expires_at)
VALUES (
  '30000000-0000-4000-8000-000000000004', 'sync_channel_delta', 'running',
  jsonb_build_object('channelId', '20000000-0000-4000-8000-000000000001'),
  '50000000-0000-4000-8000-000000000020', clock_timestamp() + INTERVAL '5 minutes'
);

SET ROLE service_role;
DO $$
DECLARE
  v_attempt RECORD;
  v_backoff RECORD;
  v_second_key RECORD;
  v_exhausted RECORD;
  v_request_key TEXT := pg_catalog.repeat('a', 64);
  v_lease UUID := '50000000-0000-4000-8000-000000000020';
BEGIN
  SELECT * INTO v_attempt FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000004', v_lease,
    '20000000-0000-4000-8000-000000000001', v_request_key, 'youtube'
  );
  IF v_attempt.status <> 'assigned' OR v_attempt.user_id <> '00000000-0000-4000-8000-000000000001'
     OR v_attempt.attempt_number <> 1 THEN RAISE EXCEPTION 'first_follower_or_attempt_assignment_failed'; END IF;

  IF NOT public.finish_channel_scan_provider_attempt(
    '30000000-0000-4000-8000-000000000004', v_lease, v_request_key,
    v_attempt.credential_id, v_attempt.key_version, 'retryable_error', NULL,
    clock_timestamp() + INTERVAL '1 hour'
  ) THEN RAISE EXCEPTION 'retryable_attempt_not_persisted'; END IF;

  SELECT * INTO v_backoff FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000004', v_lease,
    '20000000-0000-4000-8000-000000000001', v_request_key, 'youtube'
  );
  IF v_backoff.status <> 'backoff' OR v_backoff.credential_id <> v_attempt.credential_id
     OR v_backoff.attempt_number <> 1 THEN RAISE EXCEPTION 'same_key_backoff_not_enforced'; END IF;

  UPDATE public.channel_scan_provider_attempts
  SET retry_at = clock_timestamp() - INTERVAL '1 second'
  WHERE job_id = '30000000-0000-4000-8000-000000000004'
    AND request_key = v_request_key AND credential_id = v_attempt.credential_id;
  SELECT * INTO v_attempt FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000004', v_lease,
    '20000000-0000-4000-8000-000000000001', v_request_key, 'youtube'
  );
  IF v_attempt.status <> 'assigned' OR v_attempt.user_id <> '00000000-0000-4000-8000-000000000001'
     OR v_attempt.attempt_number <> 2 THEN RAISE EXCEPTION 'same_key_retry_budget_not_enforced'; END IF;

  PERFORM public.finish_channel_scan_provider_attempt(
    '30000000-0000-4000-8000-000000000004', v_lease, v_request_key,
    v_attempt.credential_id, v_attempt.key_version, 'retryable_error', NULL, NULL
  );
  SELECT * INTO v_second_key FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000004', v_lease,
    '20000000-0000-4000-8000-000000000001', v_request_key, 'youtube'
  );
  IF v_second_key.status <> 'assigned' OR v_second_key.user_id <> '00000000-0000-4000-8000-000000000002'
     OR v_second_key.attempt_number <> 1 THEN RAISE EXCEPTION 'rotation_did_not_advance_to_next_follower'; END IF;

  PERFORM public.finish_channel_scan_provider_attempt(
    '30000000-0000-4000-8000-000000000004', v_lease, v_request_key,
    v_second_key.credential_id, v_second_key.key_version, 'retryable_error', NULL, NULL
  );
  SELECT * INTO v_exhausted FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000004', v_lease,
    '20000000-0000-4000-8000-000000000001', v_request_key, 'youtube'
  );
  IF v_exhausted.status <> 'exhausted' THEN RAISE EXCEPTION 'all_exhausted_job_did_not_stop'; END IF;
END;
$$;
RESET ROLE;

-- Revocation excludes a previously assigned key immediately; key-version changes fence its old assignment.
INSERT INTO public.jobs (id, job_type, status, payload, lease_id, lease_expires_at)
VALUES (
  '30000000-0000-4000-8000-000000000005', 'sync_channel_delta', 'running',
  jsonb_build_object('channelId', '20000000-0000-4000-8000-000000000002'),
  '50000000-0000-4000-8000-000000000021', clock_timestamp() + INTERVAL '5 minutes'
);

SET ROLE service_role;
DO $$
DECLARE
  v_first RECORD;
  v_after_revocation RECORD;
  v_after_version_change RECORD;
  v_old_version UUID;
  v_request_key TEXT := pg_catalog.repeat('c', 64);
BEGIN
  SELECT * INTO v_first FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000021',
    '20000000-0000-4000-8000-000000000002', v_request_key, 'youtube'
  );
  IF v_first.user_id <> '00000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'revocation_fixture_order_invalid'; END IF;

  UPDATE public.user_channels SET is_active = FALSE, removed_at = clock_timestamp()
  WHERE user_id = '00000000-0000-4000-8000-000000000001'
    AND channel_id = '20000000-0000-4000-8000-000000000002';
  SELECT * INTO v_after_revocation FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000021',
    '20000000-0000-4000-8000-000000000002', v_request_key, 'youtube'
  );
  IF v_after_revocation.status <> 'assigned' OR v_after_revocation.user_id <> '00000000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'revoked_follower_key_was_reassigned';
  END IF;

  v_old_version := v_after_revocation.key_version;
  UPDATE public.user_provider_credential_retry_limits
  SET key_version = '40000000-0000-4000-8000-000000000022'
  WHERE credential_id = v_after_revocation.credential_id;
  SELECT * INTO v_after_version_change FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000021',
    '20000000-0000-4000-8000-000000000002', v_request_key, 'youtube'
  );
  IF v_after_version_change.status <> 'assigned'
     OR v_after_version_change.credential_id <> v_after_revocation.credential_id
     OR v_after_version_change.key_version = v_old_version THEN
    RAISE EXCEPTION 'changed_key_version_was_not_fenced_and_reassigned';
  END IF;

  UPDATE public.jobs SET lease_id = '50000000-0000-4000-8000-000000000099'
  WHERE id = '30000000-0000-4000-8000-000000000005';
  IF public.finish_channel_scan_provider_attempt(
    '30000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000021', v_request_key,
    v_after_version_change.credential_id, v_after_version_change.key_version, 'success', '{"stale":true}'::JSONB, NULL
  ) THEN RAISE EXCEPTION 'stale_scan_lease_was_accepted'; END IF;
END;
$$;
RESET ROLE;

-- Dopo la rimozione del recupero Firecrawl l'import canonico non accoda target, nemmeno con il gate storico aperto.
INSERT INTO public.videos (id, channel_id, youtube_video_id, title, published_at, video_url)
VALUES (
  '21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004',
  'yt-existing', 'Existing video', '2025-01-01T00:00:00Z', 'https://youtube.invalid/watch?v=yt-existing'
);
INSERT INTO public.video_transcripts (video_id, youtube_video_id, language_code, transcript_status, transcript_text, source, fetched_at)
VALUES (
  '21000000-0000-4000-8000-000000000001', 'yt-existing', 'unknown', 'fetched', 'previously canonical', 'fixture', clock_timestamp()
);
INSERT INTO public.jobs (id, job_type, status, payload, lease_id, lease_expires_at)
VALUES (
  '30000000-0000-4000-8000-000000000006', 'sync_channel_delta', 'running',
  jsonb_build_object('channelId', '20000000-0000-4000-8000-000000000004'),
  '50000000-0000-4000-8000-000000000030', clock_timestamp() + INTERVAL '5 minutes'
);

UPDATE public.firecrawl_transcript_recovery_settings SET enabled = TRUE WHERE id = TRUE;

SET ROLE service_role;
DO $$
DECLARE
  v_import JSONB;
  v_rows JSONB := '[
    {"youtube_video_id":"yt-existing","title":"Existing video refreshed","published_at":"2025-01-01T00:00:00Z","video_url":"https://youtube.invalid/watch?v=yt-existing","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"yt-new","title":"New video","published_at":"2026-01-01T00:00:00Z","video_url":"https://youtube.invalid/watch?v=yt-new","video_type":"standard","availability_status":"available"}
  ]'::JSONB;
BEGIN
  FOR i IN 1..2 LOOP
    v_import := public.commit_fenced_channel_import(
      '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
      '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004',
      'UC-canonical', 'Canonical channel', '@canonical', '{}'::JSONB, v_rows, 'success', 2
    );
    IF (v_import->>'importedCount')::INTEGER <> 2 OR (v_import->>'scannedCount')::INTEGER <> 2 THEN
      RAISE EXCEPTION 'canonical_import_result_changed';
    END IF;
  END LOOP;
  IF (SELECT title FROM public.videos WHERE youtube_video_id = 'yt-existing') <> 'Existing video refreshed'
     OR (SELECT count(*) FROM public.videos WHERE youtube_video_id = 'yt-new') <> 1 THEN
    RAISE EXCEPTION 'canonical_import_did_not_upsert_videos';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channel_scan_firecrawl_transcript_targets
             WHERE job_id = '30000000-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'canonical_import_enqueued_firecrawl_target';
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_transcripts WHERE youtube_video_id = 'yt-new') THEN
    RAISE EXCEPTION 'canonical_import_created_transcript_row';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.firecrawl_transcript_recovery_settings SET enabled = FALSE WHERE id = TRUE;
SELECT public.test_assert_true(
  (SELECT enabled = FALSE FROM public.firecrawl_transcript_recovery_settings WHERE id = TRUE),
  'il test lascia il gate Firecrawl chiuso'
);

-- La chiusura terminale cancella risposta/owner dal ledger canonico sotto service_role.
INSERT INTO public.job_attempts (id, job_id, attempt_number, status, started_at)
VALUES (
  '60000000-0000-4000-8000-000000000006',
  '30000000-0000-4000-8000-000000000006',
  1,
  'running',
  clock_timestamp()
);
SET ROLE service_role;
DO $$
BEGIN
  IF NOT public.finish_scan_job_attempt(
    '30000000-0000-4000-8000-000000000006',
    '50000000-0000-4000-8000-000000000030',
    '60000000-0000-4000-8000-000000000006',
    'completed',
    clock_timestamp(),
    NULL,
    '{"cleanup":"terminal"}'::JSONB
  ) THEN RAISE EXCEPTION 'terminal_scan_cleanup_not_applied'; END IF;
END;
$$;
RESET ROLE;
SELECT public.test_assert_true(
  (SELECT status = 'completed' FROM public.jobs WHERE id = '30000000-0000-4000-8000-000000000006')
  AND NOT EXISTS (
    SELECT 1 FROM public.channel_scan_provider_requests
    WHERE job_id = '30000000-0000-4000-8000-000000000006'
      AND (response IS NOT NULL OR credential_id IS NOT NULL OR user_id IS NOT NULL)
  ),
  'finish_scan_job_attempt rende terminale il job e pulisce response/owner'
);

-- ===== Trascrizioni Gemini (ticket 03): schema, RLS, ACL, vincoli e RPC con lease =====
SELECT public.test_assert_true(
  (SELECT model = 'gemini-3.1-flash-lite' AND thinking_level = 'minimal'
          AND input_price_per_million = 0.25 AND output_price_per_million = 1.5
   FROM public.transcription_profile WHERE id = TRUE),
  'il profilo di trascrizione nasce con i default approvati'
);
SELECT public.test_assert_true(
  (SELECT bool_and(c.relrowsecurity) FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.transcription_profile'::regclass, 'public.transcriptions'::regclass,
                   'public.transcription_phrases'::regclass, 'public.transcription_parts'::regclass)),
  'RLS attiva su tutte le tabelle di trascrizione'
);
SELECT public.test_assert_true(
  has_table_privilege('authenticated', 'public.transcriptions', 'SELECT')
  AND has_table_privilege('authenticated', 'public.transcription_phrases', 'SELECT')
  AND has_table_privilege('authenticated', 'public.transcription_parts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transcriptions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.transcriptions', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.transcriptions', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.transcription_phrases', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.transcription_phrases', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.transcription_phrases', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.transcription_parts', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.transcription_parts', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.transcription_parts', 'DELETE'),
  'authenticated legge soltanto le tabelle canoniche di trascrizione'
);
SELECT public.test_assert_true(
  NOT has_table_privilege('anon', 'public.transcriptions', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transcription_phrases', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transcription_parts', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transcription_profile', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transcription_profile', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transcription_profile', 'UPDATE'),
  'anon non legge nulla e il profilo non è leggibile dagli utenti'
);
SELECT public.test_assert_true(
  has_table_privilege('service_role', 'public.transcriptions', 'INSERT')
  AND has_table_privilege('service_role', 'public.transcription_phrases', 'DELETE')
  AND has_table_privilege('service_role', 'public.transcription_parts', 'UPDATE')
  AND has_table_privilege('service_role', 'public.transcription_profile', 'SELECT')
  AND has_table_privilege('service_role', 'public.transcription_profile', 'UPDATE')
  AND has_function_privilege('service_role', 'public.claim_transcription_job_with_attempt(uuid,timestamptz,uuid,timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.finish_transcription_job_attempt(uuid,uuid,uuid,text,timestamptz,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.save_transcription_part(uuid,uuid,uuid,integer,text,integer,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.finalize_transcription(uuid,uuid,uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.save_transcription_part(uuid,uuid,uuid,integer,text,integer,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_transcription_job_with_attempt(uuid,timestamptz,uuid,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.finalize_transcription(uuid,uuid,uuid,boolean)', 'EXECUTE'),
  'solo service_role scrive e invoca le RPC di trascrizione'
);

INSERT INTO public.channels (id, youtube_channel_id, title)
VALUES ('20000000-0000-4000-8000-0000000000a1', 'UC-transcription', 'Transcription channel');
INSERT INTO public.videos (id, channel_id, youtube_video_id, title, published_at, duration_seconds, video_url)
VALUES
  ('61000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'synthetic-v1', 'Video sintetico 1', NOW(), 300, 'https://www.youtube.com/watch?v=synthetic-v1'),
  ('61000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a1', 'synthetic-v2', 'Video sintetico 2', NOW(), 300, 'https://www.youtube.com/watch?v=synthetic-v2');

INSERT INTO public.transcriptions (id, video_id, status, model, thinking_level)
VALUES ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'pending', 'gemini-3.1-flash-lite', 'minimal');
INSERT INTO public.transcription_parts (transcription_id, position, start_seconds, end_seconds) VALUES
  ('62000000-0000-4000-8000-000000000001', 0, 0, 120),
  ('62000000-0000-4000-8000-000000000001', 1, 120, 240),
  ('62000000-0000-4000-8000-000000000001', 2, 240, 300);

-- Vincoli: una trascrizione per video, stati chiusi, posizioni e tempi validi.
DO $$
DECLARE v_failures INTEGER := 0;
BEGIN
  BEGIN
    INSERT INTO public.transcriptions (video_id, status, model, thinking_level)
    VALUES ('61000000-0000-4000-8000-000000000001', 'pending', 'm', 'minimal');
  EXCEPTION WHEN unique_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    INSERT INTO public.transcriptions (video_id, status, model, thinking_level)
    VALUES ('61000000-0000-4000-8000-000000000002', 'done', 'm', 'minimal');
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    INSERT INTO public.transcriptions (video_id, status, model, thinking_level, language_code)
    VALUES ('61000000-0000-4000-8000-000000000002', 'pending', 'm', 'minimal', 'Italiano!');
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    INSERT INTO public.transcription_parts (transcription_id, position, start_seconds, end_seconds)
    VALUES ('62000000-0000-4000-8000-000000000001', 9, 50, 50);
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    INSERT INTO public.transcription_parts (transcription_id, position, start_seconds, end_seconds)
    VALUES ('62000000-0000-4000-8000-000000000001', 0, 0, 120);
  EXCEPTION WHEN unique_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    INSERT INTO public.transcription_phrases (transcription_id, position, start_seconds, text)
    VALUES ('62000000-0000-4000-8000-000000000001', 0, -1, 'testo');
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    UPDATE public.transcription_profile SET thinking_level = 'extreme' WHERE id = TRUE;
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    UPDATE public.transcription_profile SET model = 'bad/model?x' WHERE id = TRUE;
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  IF v_failures <> 8 THEN RAISE EXCEPTION 'vincoli trascrizione non rispettati: %', v_failures; END IF;
END;
$$;

-- RLS: authenticated legge, anon è respinto, authenticated non scrive.
INSERT INTO public.transcription_phrases (transcription_id, position, start_seconds, text)
VALUES ('62000000-0000-4000-8000-000000000001', 5, 3, 'frase sintetica di prova');
SET ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.transcriptions) <> 1
     OR (SELECT count(*) FROM public.transcription_phrases) <> 1
     OR (SELECT count(*) FROM public.transcription_parts) <> 3 THEN
    RAISE EXCEPTION 'authenticated deve leggere il canonico';
  END IF;
  BEGIN
    INSERT INTO public.transcription_phrases (transcription_id, position, start_seconds, text)
    VALUES ('62000000-0000-4000-8000-000000000001', 6, 3, 'non consentito');
    RAISE EXCEPTION 'authenticated non deve scrivere';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.transcription_profile;
    RAISE EXCEPTION 'authenticated non deve leggere il profilo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.transcriptions;
    RAISE EXCEPTION 'anon non deve leggere le trascrizioni';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
DELETE FROM public.transcription_phrases WHERE transcription_id = '62000000-0000-4000-8000-000000000001';

-- Job con lease: claim, fencing, salvataggio per parte, finalizzazione e recupero.
INSERT INTO public.jobs (id, job_type, status, payload)
VALUES ('63000000-0000-4000-8000-000000000001', 'transcribe_video', 'pending',
        '{"videoId":"61000000-0000-4000-8000-000000000001"}'::JSONB);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.jobs (job_type, status, payload)
    VALUES ('transcribe_video', 'pending', '{"videoId":"61000000-0000-4000-8000-000000000001"}'::JSONB);
    RAISE EXCEPTION 'un secondo job attivo per lo stesso video deve essere respinto';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END;
$$;

SET ROLE service_role;
DO $$
DECLARE
  v_job UUID := '63000000-0000-4000-8000-000000000001';
  v_tr UUID := '62000000-0000-4000-8000-000000000001';
  v_lease UUID := '64000000-0000-4000-8000-000000000001';
  v_claim RECORD;
  v_status TEXT;
BEGIN
  SELECT * INTO v_claim FROM public.claim_transcription_job_with_attempt(v_job, clock_timestamp(), v_lease, clock_timestamp() + INTERVAL '5 minutes');
  IF v_claim.attempt_id IS NULL OR v_claim.attempt_number <> 1 OR v_claim.payload->>'videoId' IS NULL THEN
    RAISE EXCEPTION 'claim non riuscito';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_transcription_job_with_attempt(v_job, clock_timestamp(), '64000000-0000-4000-8000-0000000000ff', clock_timestamp() + INTERVAL '5 minutes')) THEN
    RAISE EXCEPTION 'un job running con lease valida non è reclamabile';
  END IF;

  IF public.save_transcription_part(v_job, '64000000-0000-4000-8000-0000000000ff', v_tr, 0, 'done', 1, NULL, 'it',
       '[{"idx":0,"start_seconds":1,"text":"uno","doubtful_time":false}]'::JSONB) THEN
    RAISE EXCEPTION 'una lease diversa non può scrivere';
  END IF;

  IF NOT public.save_transcription_part(v_job, v_lease, v_tr, 0, 'done', 1, NULL, 'it',
       '[{"idx":0,"start_seconds":1,"text":"uno","doubtful_time":false},{"idx":1,"start_seconds":130,"text":"due fuori blocco","doubtful_time":true}]'::JSONB) THEN
    RAISE EXCEPTION 'salvataggio parte 0 fallito';
  END IF;
  -- Rilancio della stessa parte: sostituisce le frasi senza duplicarle.
  IF NOT public.save_transcription_part(v_job, v_lease, v_tr, 0, 'done', 2, NULL, 'en',
       '[{"idx":0,"start_seconds":1,"text":"uno","doubtful_time":false},{"idx":1,"start_seconds":130,"text":"due fuori blocco","doubtful_time":true}]'::JSONB) THEN
    RAISE EXCEPTION 'riscrittura parte 0 fallita';
  END IF;
  IF (SELECT count(*) FROM public.transcription_phrases WHERE transcription_id = v_tr) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.transcription_phrases WHERE transcription_id = v_tr AND position = 1 AND doubtful_time)
     OR (SELECT language_code FROM public.transcriptions WHERE id = v_tr) <> 'it'
     OR (SELECT doubtful_phrase_count FROM public.transcriptions WHERE id = v_tr) <> 1
     OR (SELECT status FROM public.transcriptions WHERE id = v_tr) <> 'running' THEN
    RAISE EXCEPTION 'contatori o frasi parte 0 errati';
  END IF;

  v_status := public.finalize_transcription(v_job, v_lease, v_tr, FALSE);
  IF v_status <> 'running' THEN RAISE EXCEPTION 'con parti pending lo stato resta running: %', v_status; END IF;
  IF public.finalize_transcription(v_job, '64000000-0000-4000-8000-0000000000ff', v_tr, FALSE) IS NOT NULL THEN
    RAISE EXCEPTION 'finalize con lease errata deve restituire NULL';
  END IF;

  PERFORM public.save_transcription_part(v_job, v_lease, v_tr, 1, 'missing', 2, 'provider_http_500', NULL, NULL);
  v_status := public.finalize_transcription(v_job, v_lease, v_tr, TRUE);
  IF v_status <> 'needs_review'
     OR (SELECT missing_part_count FROM public.transcriptions WHERE id = v_tr) <> 2
     OR (SELECT doubtful_phrase_count FROM public.transcriptions WHERE id = v_tr) <> 1
     OR (SELECT last_error FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 2) <> 'job_stopped'
     OR (SELECT completed_at IS NULL FROM public.transcriptions WHERE id = v_tr) THEN
    RAISE EXCEPTION 'finalizzazione needs_review errata: %', v_status;
  END IF;

  IF NOT public.finish_transcription_job_attempt(v_job, v_lease, v_claim.attempt_id, 'completed', clock_timestamp(), NULL, NULL) THEN
    RAISE EXCEPTION 'chiusura attempt fallita';
  END IF;
  IF public.finish_transcription_job_attempt(v_job, v_lease, v_claim.attempt_id, 'completed', clock_timestamp(), NULL, NULL) THEN
    RAISE EXCEPTION 'una seconda chiusura non deve riuscire';
  END IF;
  IF (SELECT status FROM public.jobs WHERE id = v_job) <> 'completed'
     OR (SELECT status FROM public.job_attempts WHERE id = v_claim.attempt_id) <> 'completed' THEN
    RAISE EXCEPTION 'job o attempt non terminali';
  END IF;
END;
$$;
RESET ROLE;

-- Una trascrizione completa senza frasi dubbie né parti mancanti; rilascio `pending` per la continuazione e recupero lease scaduta.
INSERT INTO public.transcriptions (id, video_id, status, model, thinking_level)
VALUES ('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 'pending', 'gemini-3.1-flash-lite', 'minimal');
INSERT INTO public.transcription_parts (transcription_id, position, start_seconds, end_seconds)
VALUES ('62000000-0000-4000-8000-000000000002', 0, 0, 120);
INSERT INTO public.jobs (id, job_type, status, payload)
VALUES ('63000000-0000-4000-8000-000000000002', 'transcribe_video', 'pending',
        '{"videoId":"61000000-0000-4000-8000-000000000002"}'::JSONB);
SET ROLE service_role;
DO $$
DECLARE
  v_job UUID := '63000000-0000-4000-8000-000000000002';
  v_tr UUID := '62000000-0000-4000-8000-000000000002';
  v_claim RECORD;
  v_claim2 RECORD;
BEGIN
  SELECT * INTO v_claim FROM public.claim_transcription_job_with_attempt(v_job, clock_timestamp(), '64000000-0000-4000-8000-000000000002', clock_timestamp() + INTERVAL '5 minutes');
  IF NOT public.finish_transcription_job_attempt(v_job, '64000000-0000-4000-8000-000000000002', v_claim.attempt_id, 'pending', clock_timestamp(), NULL, '{"yielded":true}'::JSONB) THEN
    RAISE EXCEPTION 'rilascio pending fallito';
  END IF;
  IF (SELECT status FROM public.jobs WHERE id = v_job) <> 'pending' OR (SELECT lease_id FROM public.jobs WHERE id = v_job) IS NOT NULL THEN
    RAISE EXCEPTION 'il job rilasciato deve tornare pending senza lease';
  END IF;
  SELECT * INTO v_claim FROM public.claim_transcription_job_with_attempt(v_job, clock_timestamp(), '64000000-0000-4000-8000-000000000003', clock_timestamp() + INTERVAL '5 minutes');
  IF v_claim.attempt_number <> 2 THEN RAISE EXCEPTION 'la ripresa usa il numero attempt successivo'; END IF;
  -- Simula un worker morto: la lease scade e un nuovo claim chiude l'attempt orfano.
  UPDATE public.jobs SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = v_job;
  SELECT * INTO v_claim2 FROM public.claim_transcription_job_with_attempt(v_job, clock_timestamp(), '64000000-0000-4000-8000-000000000004', clock_timestamp() + INTERVAL '5 minutes');
  IF v_claim2.attempt_number <> 3
     OR (SELECT status FROM public.job_attempts WHERE id = v_claim.attempt_id) <> 'failed' THEN
    RAISE EXCEPTION 'recupero lease scaduta errato';
  END IF;
  -- Con la lease scaduta il vecchio worker non può più scrivere.
  IF public.save_transcription_part(v_job, '64000000-0000-4000-8000-000000000003', v_tr, 0, 'done', 1, NULL, 'it', '[]'::JSONB) THEN
    RAISE EXCEPTION 'il worker scaduto non deve scrivere';
  END IF;
  PERFORM public.save_transcription_part(v_job, '64000000-0000-4000-8000-000000000004', v_tr, 0, 'done', 1, NULL, 'it',
    '[{"idx":0,"start_seconds":2,"text":"ciao","doubtful_time":false}]'::JSONB);
  IF public.finalize_transcription(v_job, '64000000-0000-4000-8000-000000000004', v_tr, FALSE) <> 'complete' THEN
    RAISE EXCEPTION 'senza dubbi né mancanze la trascrizione è complete';
  END IF;
  PERFORM public.finish_transcription_job_attempt(v_job, '64000000-0000-4000-8000-000000000004', v_claim2.attempt_id, 'completed', clock_timestamp(), NULL, NULL);
END;
$$;
RESET ROLE;
-- Eliminare il video elimina a cascata trascrizione, parti e frasi.
DELETE FROM public.videos WHERE id = '61000000-0000-4000-8000-000000000002';
SELECT public.test_assert_true(
  NOT EXISTS (SELECT 1 FROM public.transcriptions WHERE video_id = '61000000-0000-4000-8000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.transcription_parts WHERE transcription_id = '62000000-0000-4000-8000-000000000002'),
  'la cancellazione del video elimina trascrizione e parti'
);

-- ===== Trascrizione automatica (ticket 04): accodamento atomico, eleggibilità e rotazione delle chiavi =====
SELECT public.test_assert_true(
  (SELECT bool_and(c.relrowsecurity) FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.transcription_key_rotation_cursors'::regclass, 'public.transcription_job_credentials'::regclass)),
  'RLS attiva sulle tabelle di rotazione'
);
SELECT public.test_assert_true(
  NOT has_table_privilege('anon', 'public.transcription_key_rotation_cursors', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transcription_key_rotation_cursors', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transcription_job_credentials', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transcription_job_credentials', 'INSERT')
  AND has_table_privilege('service_role', 'public.transcription_key_rotation_cursors', 'UPDATE')
  AND has_table_privilege('service_role', 'public.transcription_job_credentials', 'INSERT'),
  'le tabelle di rotazione sono accessibili solo a service_role'
);
SELECT public.test_assert_true(
  has_function_privilege('service_role', 'public.claim_transcription_job_credential(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.release_transcription_job_credential(uuid,uuid,uuid,uuid,text,uuid,integer,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.has_eligible_transcription_credential(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.enqueue_auto_transcriptions(uuid,text[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.transcription_eligible_credentials(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_transcription_job_credential(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.release_transcription_job_credential(uuid,uuid,uuid,uuid,text,uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.has_eligible_transcription_credential(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.enqueue_auto_transcriptions(uuid,text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.enqueue_auto_transcriptions(uuid,text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_transcription_job_credential(uuid,uuid,uuid)', 'EXECUTE'),
  'solo service_role esegue le RPC di rotazione e di accodamento automatico'
);
SELECT public.test_assert_true(
  (SELECT p.prosecdef AND pg_catalog.array_to_string(p.proconfig, ',') = 'search_path=""'
   FROM pg_catalog.pg_proc p WHERE p.oid = 'public.enqueue_auto_transcriptions(uuid,text[])'::regprocedure)
  AND (SELECT p.prosecdef FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.commit_fenced_channel_import(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,integer)'::regprocedure)
  AND (SELECT pg_catalog.array_to_string(p.proconfig, ',') = 'search_path=""' FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.commit_fenced_channel_import(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,integer)'::regprocedure)
  AND has_function_privilege('service_role', 'public.commit_fenced_channel_import(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,integer)', 'EXECUTE'),
  'accodamento SECURITY DEFINER con search_path vuoto; l import mantiene firma, definer e search_path'
);

-- ---- Accodamento atomico con l'import: solo video nuovi, soglia 90 minuti (5400 incluso), nessun doppione ----
INSERT INTO public.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'scan-owner@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'g1@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', 'g2@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b3', 'g3@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b4', 'outsider@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b5', 'invalid-key@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b6', 'left-channel@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b7', 'no-key@example.invalid');
INSERT INTO public.channels (id, youtube_channel_id, title) VALUES
  ('20000000-0000-4000-8000-0000000000c1', 'UC-auto-enqueue', 'Auto enqueue channel');
INSERT INTO public.user_channels (user_id, channel_id, is_active, added_at) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1', TRUE, '2020-01-01T00:00:00Z');
INSERT INTO public.videos (id, channel_id, youtube_video_id, title, published_at, duration_seconds, video_url) VALUES
  ('71000000-0000-4000-8000-000000000000', '20000000-0000-4000-8000-0000000000c1', 'auto-old', 'Video già presente', '2025-01-01T00:00:00Z', 300, 'https://youtube.invalid/watch?v=auto-old');
INSERT INTO public.jobs (id, job_type, status, payload, lease_id, lease_expires_at) VALUES
  ('72000000-0000-4000-8000-000000000001', 'sync_channel_delta', 'running',
   jsonb_build_object('channelId', '20000000-0000-4000-8000-0000000000c1'),
   '73000000-0000-4000-8000-000000000001', clock_timestamp() + INTERVAL '10 minutes');

SET ROLE service_role;
DO $$
DECLARE
  v_rows JSONB := '[
    {"youtube_video_id":"auto-old","title":"Già presente","published_at":"2025-01-01T00:00:00Z","duration_seconds":300,"video_url":"https://youtube.invalid/watch?v=auto-old","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-hist","title":"Storico della prima scansione","published_at":"2025-02-01T00:00:00Z","duration_seconds":300,"video_url":"https://youtube.invalid/watch?v=auto-hist","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-5400","title":"Limite incluso","published_at":"2026-01-05T00:00:00Z","duration_seconds":5400,"video_url":"https://youtube.invalid/watch?v=auto-5400","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-5401","title":"Oltre il limite","published_at":"2026-01-04T00:00:00Z","duration_seconds":5401,"video_url":"https://youtube.invalid/watch?v=auto-5401","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-null","title":"Durata ignota","published_at":"2026-01-03T00:00:00Z","video_url":"https://youtube.invalid/watch?v=auto-null","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-zero","title":"Durata zero","published_at":"2026-01-02T00:00:00Z","duration_seconds":0,"video_url":"https://youtube.invalid/watch?v=auto-zero","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-one","title":"Un secondo","published_at":"2026-01-01T00:00:00Z","duration_seconds":1,"video_url":"https://youtube.invalid/watch?v=auto-one","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-private","title":"Privato","published_at":"2026-01-06T00:00:00Z","duration_seconds":100,"video_url":"https://youtube.invalid/watch?v=auto-private","video_type":"standard","availability_status":"private"}
  ]'::JSONB;
  v_first_rows JSONB := '[
    {"youtube_video_id":"auto-hist","title":"Storico della prima scansione","published_at":"2025-02-01T00:00:00Z","duration_seconds":300,"video_url":"https://youtube.invalid/watch?v=auto-hist","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"auto-first-short","title":"Corto ma storico","published_at":"2025-03-01T00:00:00Z","duration_seconds":60,"video_url":"https://youtube.invalid/watch?v=auto-first-short","video_type":"standard","availability_status":"available"}
  ]'::JSONB;
  v_import JSONB;
BEGIN
  -- Prima scansione del canale (nessuna sync precedente): nessun accodamento, anche per video corti e disponibili.
  v_import := public.commit_fenced_channel_import(
    '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1',
    'UC-auto-enqueue', 'Auto enqueue channel', NULL, '{}'::JSONB, v_first_rows, 'success', 2
  );
  IF (v_import->>'transcriptionsQueued')::INTEGER <> 0 OR (v_import->>'importedCount')::INTEGER <> 2
     OR EXISTS (SELECT 1 FROM public.transcriptions t JOIN public.videos v ON v.id = t.video_id
                WHERE v.channel_id = '20000000-0000-4000-8000-0000000000c1')
     OR EXISTS (SELECT 1 FROM public.jobs WHERE job_type = 'transcribe_video' AND payload->>'channelId' = '20000000-0000-4000-8000-0000000000c1')
     OR (SELECT last_sync_at FROM public.canonical_sync_state WHERE channel_id = '20000000-0000-4000-8000-0000000000c1') IS NULL THEN
    RAISE EXCEPTION 'prima scansione: nessuna trascrizione accodata e stato sync aggiornato: %', v_import;
  END IF;

  -- Seconda scansione con video nuovi: solo quelli entro 5400 secondi vengono accodati.
  v_import := public.commit_fenced_channel_import(
    '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1',
    'UC-auto-enqueue', 'Auto enqueue channel', NULL, '{}'::JSONB, v_rows, 'success', 8
  );
  IF (v_import->>'transcriptionsQueued')::INTEGER <> 2 OR (v_import->>'importedCount')::INTEGER <> 8 THEN
    RAISE EXCEPTION 'import automatico: attesi 2 accodati e 7 importati, ottenuto %', v_import;
  END IF;
  IF (SELECT array_agg(v.youtube_video_id ORDER BY v.youtube_video_id)
      FROM public.transcriptions t JOIN public.videos v ON v.id = t.video_id
      WHERE v.channel_id = '20000000-0000-4000-8000-0000000000c1') IS DISTINCT FROM ARRAY['auto-5400', 'auto-one'] THEN
    RAISE EXCEPTION 'solo i video nuovi entro 5400 secondi vengono accodati';
  END IF;
  IF (SELECT count(*) FROM public.transcription_parts p JOIN public.transcriptions t ON t.id = p.transcription_id
      JOIN public.videos v ON v.id = t.video_id WHERE v.youtube_video_id = 'auto-5400') <> 45
     OR (SELECT max(p.end_seconds) FROM public.transcription_parts p JOIN public.transcriptions t ON t.id = p.transcription_id
         JOIN public.videos v ON v.id = t.video_id WHERE v.youtube_video_id = 'auto-5400') <> 5400
     OR (SELECT min(p.start_seconds) FROM public.transcription_parts p JOIN public.transcriptions t ON t.id = p.transcription_id
         JOIN public.videos v ON v.id = t.video_id WHERE v.youtube_video_id = 'auto-5400' AND p.position = 44) <> 5280
     OR (SELECT count(*) FROM public.transcription_parts p JOIN public.transcriptions t ON t.id = p.transcription_id
         JOIN public.videos v ON v.id = t.video_id WHERE v.youtube_video_id = 'auto-one' AND p.start_seconds = 0 AND p.end_seconds = 1) <> 1 THEN
    RAISE EXCEPTION 'parti da 120 secondi errate';
  END IF;
  IF (SELECT count(*) FROM public.jobs WHERE job_type = 'transcribe_video' AND payload->>'channelId' = '20000000-0000-4000-8000-0000000000c1') <> 2
     OR EXISTS (SELECT 1 FROM public.jobs WHERE job_type = 'transcribe_video' AND payload ? 'channelId'
                AND (payload->>'channelId' IS DISTINCT FROM '20000000-0000-4000-8000-0000000000c1'
                     OR payload->'requestedByUserId' <> 'null'::JSONB OR payload->'credentialOwnerUserId' <> 'null'::JSONB
                     OR created_by_user_id IS NOT NULL OR status <> 'pending'))
     OR EXISTS (SELECT 1 FROM public.transcriptions t JOIN public.videos v ON v.id = t.video_id
                WHERE v.channel_id = '20000000-0000-4000-8000-0000000000c1' AND (t.requested_by_user_id IS NOT NULL OR t.status <> 'pending')) THEN
    RAISE EXCEPTION 'i job automatici non hanno richiedente e partono pending';
  END IF;

  -- Una seconda scansione degli stessi video non crea doppioni (i video ora esistono).
  v_import := public.commit_fenced_channel_import(
    '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c1',
    'UC-auto-enqueue', 'Auto enqueue channel', NULL, '{}'::JSONB, v_rows, 'success', 8
  );
  IF (v_import->>'transcriptionsQueued')::INTEGER <> 0
     OR (SELECT count(*) FROM public.jobs WHERE job_type = 'transcribe_video' AND payload->>'channelId' = '20000000-0000-4000-8000-0000000000c1') <> 2 THEN
    RAISE EXCEPTION 'la riscansione non deve accodare doppioni';
  END IF;

  -- Idempotenza diretta: trascrizione già esistente (anche manuale) e job attivo senza trascrizione non vengono rifatti.
  IF public.enqueue_auto_transcriptions('20000000-0000-4000-8000-0000000000c1', ARRAY['auto-5400', 'auto-one']) <> 0 THEN
    RAISE EXCEPTION 'nessun doppione se la trascrizione esiste';
  END IF;
  INSERT INTO public.videos (id, channel_id, youtube_video_id, title, published_at, duration_seconds, video_url)
  VALUES ('71000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-0000000000c1', 'auto-active-job', 'Job già attivo',
          '2026-01-07T00:00:00Z', 100, 'https://youtube.invalid/watch?v=auto-active-job');
  INSERT INTO public.jobs (job_type, status, payload)
  VALUES ('transcribe_video', 'running', '{"videoId":"71000000-0000-4000-8000-000000000008"}'::JSONB);
  IF public.enqueue_auto_transcriptions('20000000-0000-4000-8000-0000000000c1', ARRAY['auto-active-job']) <> 0
     OR EXISTS (SELECT 1 FROM public.transcriptions t WHERE t.video_id = '71000000-0000-4000-8000-000000000008') THEN
    RAISE EXCEPTION 'nessun accodamento se esiste già un job attivo';
  END IF;
  -- Video di un altro canale ignorato.
  IF public.enqueue_auto_transcriptions('20000000-0000-4000-8000-0000000000c1', ARRAY['yt-new', 'yt-existing']) <> 0 THEN
    RAISE EXCEPTION 'solo i video del canale indicato';
  END IF;
END;
$$;
RESET ROLE;

-- ---- Rotazione delle chiavi: follower con chiave valida, round-robin per canale e provider ----
INSERT INTO public.channels (id, youtube_channel_id, title) VALUES
  ('20000000-0000-4000-8000-0000000000d1', 'UC-rot-one', 'Rotation one'),
  ('20000000-0000-4000-8000-0000000000d2', 'UC-rot-two', 'Rotation two'),
  ('20000000-0000-4000-8000-0000000000d3', 'UC-rot-wait', 'Rotation waiting');
INSERT INTO public.user_provider_credentials (id, user_id, provider, encrypted_key, is_configured, is_valid) VALUES
  ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', 'gemini', 'cipher-g1', TRUE, TRUE),
  ('10000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', 'gemini', 'cipher-g2', TRUE, NULL),
  ('10000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b3', 'gemini', 'cipher-g3', TRUE, TRUE),
  ('10000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000b4', 'gemini', 'cipher-out', TRUE, TRUE),
  ('10000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000b5', 'gemini', 'cipher-inv', TRUE, FALSE),
  ('10000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000b6', 'gemini', 'cipher-left', TRUE, TRUE),
  ('10000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000b1', 'youtube', 'cipher-yt-g1', TRUE, TRUE);
-- Canale 1: g1, g2, g3 con chiave valida; g5 con chiave non valida; g6 ha smesso di seguire; g7 senza chiave; outsider non segue.
INSERT INTO public.user_channels (user_id, channel_id, is_active, added_at) VALUES
  ('00000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000d1', TRUE, '2020-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000d1', TRUE, '2021-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b3', '20000000-0000-4000-8000-0000000000d1', TRUE, '2022-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b5', '20000000-0000-4000-8000-0000000000d1', TRUE, '2022-06-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b6', '20000000-0000-4000-8000-0000000000d1', FALSE, '2022-07-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b7', '20000000-0000-4000-8000-0000000000d1', TRUE, '2022-08-01T00:00:00Z'),
-- Canale 2: solo g2 e g3. Canale 3: solo una chiave non valida.
  ('00000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000d2', TRUE, '2021-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b3', '20000000-0000-4000-8000-0000000000d2', TRUE, '2022-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b5', '20000000-0000-4000-8000-0000000000d3', TRUE, '2022-06-01T00:00:00Z');
UPDATE public.user_provider_credential_retry_limits SET retry_limit = 3
WHERE credential_id = '10000000-0000-4000-8000-0000000000b1';

-- Crea un job di trascrizione running con lease valida (lease = id del job) per il canale indicato.
CREATE FUNCTION public.test_rot_job(p_n INTEGER, p_channel UUID) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_id UUID := ('74000000-0000-4000-8000-' || lpad(p_n::TEXT, 12, '0'))::UUID;
BEGIN
  INSERT INTO public.jobs (id, job_type, status, payload, lease_id, lease_expires_at)
  VALUES (v_id, 'transcribe_video', 'running',
          jsonb_build_object('videoId', 'rot-video-' || p_n, 'channelId', p_channel),
          v_id, clock_timestamp() + INTERVAL '10 minutes');
  RETURN v_id;
END $$;
-- Utente (come testo) a cui il job è assegnato per il canale.
CREATE FUNCTION public.test_rot_claim(p_job UUID, p_channel UUID) RETURNS TEXT
LANGUAGE sql AS $$
  SELECT CASE WHEN c.status = 'assigned' THEN right(c.user_id::TEXT, 2) ELSE c.status END
  FROM public.claim_transcription_job_credential(p_job, p_job, p_channel) AS c
$$;
GRANT EXECUTE ON FUNCTION public.test_rot_job(INTEGER, UUID), public.test_rot_claim(UUID, UUID) TO service_role;

SELECT public.test_assert_true(
  (SELECT array_agg(right(e.user_id::TEXT, 2) ORDER BY e.ord) FROM public.transcription_eligible_credentials('20000000-0000-4000-8000-0000000000d1') e)
    = ARRAY['b1', 'b2', 'b3'],
  'eleggibili: follower attivi con chiave Gemini valida; non follower, chiave non valida, ex follower e senza chiave esclusi'
);
SELECT public.test_assert_true(
  public.has_eligible_transcription_credential('20000000-0000-4000-8000-0000000000d1')
  AND NOT public.has_eligible_transcription_credential('20000000-0000-4000-8000-0000000000d3'),
  'has_eligible riflette l eleggibilità del canale'
);

SET ROLE service_role;
DO $$
DECLARE
  c1 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d1';
  c2 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d2';
  c3 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d3';
  v_seq TEXT[] := ARRAY[]::TEXT[];
  v_job UUID;
  v_row RECORD;
BEGIN
  -- Lavori successivi del canale 1 alternano g1, g2, g3, g1; la chiave assegnata a un job è stabile per i retry.
  FOR i IN 1..4 LOOP
    v_job := public.test_rot_job(i, c1);
    v_seq := v_seq || public.test_rot_claim(v_job, c1);
    IF public.test_rot_claim(v_job, c1) <> v_seq[i] THEN RAISE EXCEPTION 'la chiave assegnata a un job deve restare la stessa'; END IF;
  END LOOP;
  IF v_seq <> ARRAY['b1', 'b2', 'b3', 'b1'] THEN RAISE EXCEPTION 'round-robin canale 1: %', v_seq; END IF;

  -- Il canale 2 ha un cursore indipendente: parte dal primo follower anche se il canale 1 è andato avanti.
  v_seq := ARRAY[]::TEXT[];
  FOR i IN 11..13 LOOP
    v_seq := v_seq || public.test_rot_claim(public.test_rot_job(i, c2), c2);
  END LOOP;
  IF v_seq <> ARRAY['b2', 'b3', 'b2'] THEN RAISE EXCEPTION 'round-robin canale 2 indipendente: %', v_seq; END IF;

  -- Alternanza intrecciata: il canale 1 prosegue da dove era (dopo b1 viene b2), senza essere influenzato dal canale 2.
  IF public.test_rot_claim(public.test_rot_job(21, c1), c1) <> 'b2'
     OR public.test_rot_claim(public.test_rot_job(22, c2), c2) <> 'b3'
     OR public.test_rot_claim(public.test_rot_job(23, c1), c1) <> 'b3' THEN
    RAISE EXCEPTION 'cursori per canale non indipendenti';
  END IF;

  -- Mai chiavi di non follower, ex follower, chiavi non valide o utenti senza chiave; il provider è sempre gemini.
  IF EXISTS (
    SELECT 1 FROM public.transcription_job_credentials jk
    JOIN public.user_provider_credentials c ON c.id = jk.credential_id
    WHERE c.provider <> 'gemini' OR right(c.user_id::TEXT, 2) NOT IN ('b1', 'b2', 'b3')
  ) THEN RAISE EXCEPTION 'assegnata una chiave non eleggibile'; END IF;
  IF (SELECT count(*) FROM public.transcription_key_rotation_cursors WHERE provider = 'gemini') <> 2 THEN
    RAISE EXCEPTION 'un cursore per canale e provider';
  END IF;

END;
$$;
RESET ROLE;

-- Chiave singola di un canale: il limite retry individuale viaggia con l'assegnazione e conta solo il provider gemini.
INSERT INTO public.channels (id, youtube_channel_id, title) VALUES ('20000000-0000-4000-8000-0000000000d4', 'UC-rot-single', 'Rotation single');
INSERT INTO public.user_channels (user_id, channel_id, is_active, added_at) VALUES
  ('00000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000d4', TRUE, '2020-01-01T00:00:00Z');
SET ROLE service_role;
DO $$
DECLARE
  c4 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d4';
  v_job UUID := public.test_rot_job(61, c4);
  v_first RECORD;
  v_second RECORD;
BEGIN
  SELECT * INTO v_first FROM public.claim_transcription_job_credential(v_job, v_job, c4);
  IF v_first.status <> 'assigned' OR v_first.credential_id <> '10000000-0000-4000-8000-0000000000b1' OR v_first.retry_limit <> 3 THEN
    RAISE EXCEPTION 'chiave singola gemini con retry 3: %', v_first;
  END IF;
  -- Sostituzione della chiave (nuova key_version): l'assegnazione precedente decade e si assegna la nuova versione.
  UPDATE public.user_provider_credential_retry_limits SET key_version = public.uuid_generate_v4(), retry_limit = 1
  WHERE credential_id = '10000000-0000-4000-8000-0000000000b1';
  SELECT * INTO v_second FROM public.claim_transcription_job_credential(v_job, v_job, c4);
  IF v_second.status <> 'assigned' OR v_second.key_version = v_first.key_version OR v_second.retry_limit <> 1
     OR (SELECT status FROM public.transcription_job_credentials WHERE job_id = v_job AND key_version = v_first.key_version) <> 'ineligible' THEN
    RAISE EXCEPTION 'la nuova versione della chiave sostituisce la precedente: %', v_second;
  END IF;
  UPDATE public.user_provider_credential_retry_limits SET retry_limit = 3 WHERE credential_id = '10000000-0000-4000-8000-0000000000b1';
END;
$$;
RESET ROLE;

-- Esaurimento: il job passa alla chiave successiva, le parti pending ripartono da zero tentativi, nessun ritorno su una chiave esaurita.
INSERT INTO public.videos (id, channel_id, youtube_video_id, title, published_at, duration_seconds, video_url)
VALUES ('71000000-0000-4000-8000-000000000041', '20000000-0000-4000-8000-0000000000d1', 'rot-exhaust', 'Video rotazione', NOW(), 480,
        'https://youtube.invalid/watch?v=rot-exhaust');
INSERT INTO public.transcriptions (id, video_id, status, model, thinking_level)
VALUES ('62000000-0000-4000-8000-000000000041', '71000000-0000-4000-8000-000000000041', 'running', 'gemini-3.1-flash-lite', 'minimal');
INSERT INTO public.transcription_parts (transcription_id, position, start_seconds, end_seconds, status, attempts, last_error) VALUES
  ('62000000-0000-4000-8000-000000000041', 0, 0, 120, 'done', 1, NULL),
  ('62000000-0000-4000-8000-000000000041', 1, 120, 240, 'pending', 1, NULL),
  ('62000000-0000-4000-8000-000000000041', 2, 240, 360, 'pending', 1, NULL),
  ('62000000-0000-4000-8000-000000000041', 3, 360, 480, 'missing', 3, 'provider_http_500');
SET ROLE service_role;
DO $$
DECLARE
  c1 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d1';
  v_tr CONSTANT UUID := '62000000-0000-4000-8000-000000000041';
  v_job UUID := public.test_rot_job(41, c1);
  v_row RECORD;
  v_seen TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR i IN 1..3 LOOP
    SELECT * INTO v_row FROM public.claim_transcription_job_credential(v_job, v_job, c1);
    IF v_row.status <> 'assigned' THEN RAISE EXCEPTION 'attesa assegnazione al passo %, ottenuto %', i, v_row.status; END IF;
    v_seen := v_seen || right(v_row.user_id::TEXT, 2);
    IF NOT public.release_transcription_job_credential(v_job, v_job, v_row.credential_id, v_row.key_version,
                                                      'exhausted', v_tr, 1, 'provider_http_503') THEN
      RAISE EXCEPTION 'rilascio chiave fallito';
    END IF;
  END LOOP;
  IF v_seen <> ARRAY['b1', 'b2', 'b3'] THEN RAISE EXCEPTION 'ordine di passaggio fra le chiavi: %', v_seen; END IF;
  IF public.test_rot_claim(v_job, c1) <> 'exhausted' OR public.test_rot_claim(v_job, c1) <> 'exhausted' THEN
    RAISE EXCEPTION 'tutte le chiavi usate: nessun ritorno su una chiave esaurita';
  END IF;
  IF (SELECT count(*) FROM public.transcription_job_credentials WHERE job_id = v_job AND status = 'exhausted') <> 3
     OR EXISTS (SELECT 1 FROM public.transcription_job_credentials WHERE job_id = v_job AND status = 'active') THEN
    RAISE EXCEPTION 'tre chiavi esaurite e nessuna attiva';
  END IF;
  IF (SELECT array_agg(attempts ORDER BY position) FROM public.transcription_parts WHERE transcription_id = v_tr) <> ARRAY[1, 0, 0, 3]
     OR (SELECT last_error FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 1) <> 'provider_http_503'
     OR (SELECT status FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 0) <> 'done'
     OR (SELECT status FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 3) <> 'missing' THEN
    RAISE EXCEPTION 'solo le parti pending ripartono da zero tentativi';
  END IF;
  -- Stato incoerente richiesto dal chiamante: stato chiave non ammesso.
  BEGIN
    PERFORM public.release_transcription_job_credential(v_job, v_job, gen_random_uuid(), gen_random_uuid(), 'active', v_tr, NULL, NULL);
    RAISE EXCEPTION 'uno stato non ammesso deve essere respinto';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_transcription_credential_status' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- Chiave rimossa, invalidata o follower che smette di seguire durante il lavoro: esclusa dalle assegnazioni successive.
SET ROLE service_role;
DO $$
DECLARE
  c1 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d1';
  v_job UUID := public.test_rot_job(51, c1);
  v_step TEXT;
BEGIN
  v_step := public.test_rot_claim(v_job, c1);
  IF v_step <> 'b1' THEN RAISE EXCEPTION 'primo follower atteso b1, ottenuto %', v_step; END IF;
  UPDATE public.user_provider_credentials SET is_valid = FALSE WHERE id = '10000000-0000-4000-8000-0000000000b1';
  v_step := public.test_rot_claim(v_job, c1);
  IF v_step <> 'b2' THEN RAISE EXCEPTION 'chiave invalidata esclusa, atteso b2, ottenuto %', v_step; END IF;
  UPDATE public.user_channels SET is_active = FALSE
  WHERE user_id = '00000000-0000-4000-8000-0000000000b2' AND channel_id = c1;
  v_step := public.test_rot_claim(v_job, c1);
  IF v_step <> 'b3' THEN RAISE EXCEPTION 'ex follower escluso, atteso b3, ottenuto %', v_step; END IF;
  UPDATE public.user_provider_credentials SET is_configured = FALSE WHERE id = '10000000-0000-4000-8000-0000000000b3';
  v_step := public.test_rot_claim(v_job, c1);
  IF v_step <> 'waiting' THEN RAISE EXCEPTION 'nessuna chiave eleggibile: attesa, ottenuto %', v_step; END IF;
  IF (SELECT array_agg(right(c.user_id::TEXT, 2) || ':' || jk.status ORDER BY right(c.user_id::TEXT, 2))
      FROM public.transcription_job_credentials jk JOIN public.user_provider_credentials c ON c.id = jk.credential_id
      WHERE jk.job_id = v_job) <> ARRAY['b1:ineligible', 'b2:ineligible', 'b3:ineligible'] THEN
    RAISE EXCEPTION 'le chiavi non più eleggibili risultano ineligible';
  END IF;
  -- Ripristino per gli altri controlli.
  UPDATE public.user_provider_credentials SET is_valid = TRUE WHERE id = '10000000-0000-4000-8000-0000000000b1';
  UPDATE public.user_provider_credentials SET is_configured = TRUE WHERE id = '10000000-0000-4000-8000-0000000000b3';
  UPDATE public.user_channels SET is_active = TRUE
  WHERE user_id = '00000000-0000-4000-8000-0000000000b2' AND channel_id = c1;
END;
$$;
RESET ROLE;

-- Esaurimento PER PARTE: la parte passa alla chiave successiva, le altre restano sulla chiave del job; mai ritorni.
SELECT public.test_assert_true(
  (SELECT bool_and(c.relrowsecurity) FROM pg_catalog.pg_class c WHERE c.oid = 'public.transcription_part_exhausted_keys'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.transcription_part_exhausted_keys', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transcription_part_exhausted_keys', 'SELECT')
  AND has_table_privilege('service_role', 'public.transcription_part_exhausted_keys', 'INSERT')
  AND has_function_privilege('service_role', 'public.claim_transcription_part_credential(uuid,uuid,uuid,uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.record_transcription_part_key_exhausted(uuid,uuid,uuid,integer,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_transcription_part_credential(uuid,uuid,uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.record_transcription_part_key_exhausted(uuid,uuid,uuid,integer,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_transcription_part_credential(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  'ACL e RLS della tabella e delle RPC di esaurimento per parte'
);
SET ROLE service_role;
DO $$
DECLARE
  c1 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d1';
  v_tr CONSTANT UUID := '62000000-0000-4000-8000-000000000041';
  v_job UUID := public.test_rot_job(81, c1);
  v_key RECORD;
  v_k1 RECORD;
  v_k2 RECORD;
  v_k3 RECORD;
  v_other RECORD;
  v_ok BOOLEAN;
  v_ok2 BOOLEAN;
BEGIN
  SELECT * INTO v_key FROM public.claim_transcription_job_credential(v_job, v_job, c1);
  SELECT * INTO v_k1 FROM public.claim_transcription_part_credential(v_job, v_job, c1, v_tr, 1);
  IF v_k1.status <> 'assigned' OR v_k1.credential_id <> v_key.credential_id THEN
    RAISE EXCEPTION 'la parte parte dalla chiave del job';
  END IF;
  UPDATE public.transcription_parts SET attempts = 2 WHERE transcription_id = v_tr AND position = 1;

  -- Chiave del job esaurita sulla sola parte 1: tentativi azzerati, errore registrato, parte ancora pending.
  v_ok := public.record_transcription_part_key_exhausted(v_job, v_job, v_tr, 1, v_k1.credential_id, v_k1.key_version, 'provider_http_503');
  IF NOT v_ok
     OR (SELECT attempts FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 1) <> 0
     OR (SELECT last_error FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 1) <> 'provider_http_503'
     OR (SELECT status FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 1) <> 'pending' THEN
    RAISE EXCEPTION 'registrazione chiave esaurita per parte: %', (SELECT row(attempts, last_error, status) FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 1);
  END IF;
  -- Idempotente.
  PERFORM public.record_transcription_part_key_exhausted(v_job, v_job, v_tr, 1, v_k1.credential_id, v_k1.key_version, 'provider_http_503');

  SELECT * INTO v_k2 FROM public.claim_transcription_part_credential(v_job, v_job, c1, v_tr, 1);
  IF v_k2.status <> 'assigned' OR v_k2.credential_id = v_k1.credential_id THEN
    RAISE EXCEPTION 'la parte 1 passa a un altra chiave';
  END IF;
  -- Le altre parti restano sulla chiave del job e il job non cambia chiave.
  SELECT * INTO v_other FROM public.claim_transcription_part_credential(v_job, v_job, c1, v_tr, 2);
  IF v_other.credential_id <> v_key.credential_id
     OR (SELECT credential_id FROM public.transcription_job_credentials WHERE job_id = v_job AND status = 'active') <> v_key.credential_id
     OR EXISTS (SELECT 1 FROM public.transcription_job_credentials WHERE job_id = v_job AND status <> 'active') THEN
    RAISE EXCEPTION 'le altre parti continuano con la chiave del job';
  END IF;

  -- Una chiave diventata ineleggibile è esclusa anche per le parti: invalidata la seconda, la parte 1 usa la terza.
  PERFORM public.record_transcription_part_key_exhausted(v_job, v_job, v_tr, 1, v_k2.credential_id, v_k2.key_version, 'provider_http_503');
  SELECT * INTO v_k3 FROM public.claim_transcription_part_credential(v_job, v_job, c1, v_tr, 1);
  IF v_k3.status <> 'assigned' OR v_k3.credential_id IN (v_k1.credential_id, v_k2.credential_id) THEN
    RAISE EXCEPTION 'terza chiave distinta per la parte 1';
  END IF;
  UPDATE public.user_provider_credentials SET is_valid = FALSE WHERE id = v_k3.credential_id;
  IF (SELECT status FROM public.claim_transcription_part_credential(v_job, v_job, c1, v_tr, 1)) <> 'none' THEN
    RAISE EXCEPTION 'chiave invalidata esclusa per la parte: nessuna rimasta';
  END IF;
  UPDATE public.user_provider_credentials SET is_valid = TRUE WHERE id = v_k3.credential_id;

  -- Tutte esaurite per la parte 1: nessuna chiave, mai ritorni; la parte 2 resta servita.
  PERFORM public.record_transcription_part_key_exhausted(v_job, v_job, v_tr, 1, v_k3.credential_id, v_k3.key_version, 'provider_http_503');
  IF (SELECT status FROM public.claim_transcription_part_credential(v_job, v_job, c1, v_tr, 1)) <> 'none'
     OR (SELECT status FROM public.claim_transcription_part_credential(v_job, v_job, c1, v_tr, 2)) <> 'assigned'
     OR (SELECT count(*) FROM public.transcription_part_exhausted_keys WHERE transcription_id = v_tr AND part_position = 1) <> 3
     OR EXISTS (SELECT 1 FROM public.transcription_part_exhausted_keys WHERE transcription_id = v_tr AND part_position = 2) THEN
    RAISE EXCEPTION 'tutte le chiavi esaurite per la sola parte 1';
  END IF;

  -- Lease persa: nessuna assegnazione e nessuna scrittura.
  v_ok2 := public.record_transcription_part_key_exhausted(v_job, gen_random_uuid(), v_tr, 2, v_k1.credential_id, v_k1.key_version, 'x');
  IF (SELECT status FROM public.claim_transcription_part_credential(v_job, gen_random_uuid(), c1, v_tr, 2)) <> 'lease_lost'
     OR v_ok2 THEN
    RAISE EXCEPTION 'lease diversa';
  END IF;

  -- Eliminare la parte elimina a cascata le chiavi esaurite.
  DELETE FROM public.transcription_parts WHERE transcription_id = v_tr AND position = 1;
  IF EXISTS (SELECT 1 FROM public.transcription_part_exhausted_keys WHERE transcription_id = v_tr) THEN
    RAISE EXCEPTION 'cascata sulle chiavi esaurite';
  END IF;
END;
$$;
RESET ROLE;

-- Nessuna chiave eleggibile: attesa senza assegnare nulla; lease persa o canale diverso dal payload: nessuna scrittura.
SET ROLE service_role;
DO $$
DECLARE
  c1 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d1';
  c3 CONSTANT UUID := '20000000-0000-4000-8000-0000000000d3';
  v_wait UUID := public.test_rot_job(71, c3);
  v_expired UUID := public.test_rot_job(72, c1);
  v_other UUID := public.test_rot_job(73, c1);
BEGIN
  IF public.test_rot_claim(v_wait, c3) <> 'waiting'
     OR EXISTS (SELECT 1 FROM public.transcription_job_credentials WHERE job_id = v_wait)
     OR EXISTS (SELECT 1 FROM public.transcription_key_rotation_cursors WHERE channel_id = c3 AND last_credential_id IS NOT NULL) THEN
    RAISE EXCEPTION 'canale senza chiavi eleggibili: il job attende senza assegnazioni né avanzamento del cursore';
  END IF;
  UPDATE public.jobs SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = v_expired;
  IF public.test_rot_claim(v_expired, c1) <> 'lease_lost' THEN RAISE EXCEPTION 'lease scaduta'; END IF;
  IF (SELECT status FROM public.claim_transcription_job_credential(v_other, gen_random_uuid(), c1)) <> 'lease_lost' THEN
    RAISE EXCEPTION 'lease diversa';
  END IF;
  IF (SELECT status FROM public.claim_transcription_job_credential(v_other, v_other, '20000000-0000-4000-8000-0000000000d2')) <> 'lease_lost' THEN
    RAISE EXCEPTION 'canale diverso dal payload';
  END IF;
  IF public.release_transcription_job_credential(v_expired, v_expired, '10000000-0000-4000-8000-0000000000b1', public.uuid_generate_v4(),
                                                'exhausted', '62000000-0000-4000-8000-000000000041', NULL, NULL) THEN
    RAISE EXCEPTION 'rilascio con lease scaduta deve restituire false';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transcription_job_credentials WHERE job_id IN (v_expired, v_other)) THEN
    RAISE EXCEPTION 'nessuna assegnazione con lease persa';
  END IF;
END;
$$;
RESET ROLE;

-- ===== Profilo di trascrizione admin (ticket 05): RPC atomica con audit e ACL =====
SELECT public.test_assert_true(
  NOT has_function_privilege('authenticated', 'public.update_transcription_profile(text,text,numeric,numeric,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_transcription_profile(text,text,numeric,numeric,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.update_transcription_profile(text,text,numeric,numeric,text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.transcription_profile_audit', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transcription_profile_audit', 'SELECT')
  AND has_table_privilege('service_role', 'public.transcription_profile_audit', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.transcription_profile_audit', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.transcription_profile_audit', 'DELETE'),
  'ACL profilo di trascrizione admin: solo service_role'
);
DO $$
DECLARE
  v_saved RECORD;
  v_audit RECORD;
  v_failures INTEGER := 0;
BEGIN
  SELECT * INTO v_saved FROM public.update_transcription_profile('gemini-2.5-flash', 'low', 0.3, 2.5, 'admin-test');
  IF v_saved.model <> 'gemini-2.5-flash' OR v_saved.thinking_level <> 'low'
     OR v_saved.input_price_per_million <> 0.3 OR v_saved.output_price_per_million <> 2.5 THEN
    RAISE EXCEPTION 'profilo non aggiornato';
  END IF;
  SELECT * INTO v_audit FROM public.transcription_profile_audit ORDER BY created_at DESC LIMIT 1;
  IF v_audit.admin_username <> 'admin-test'
     OR v_audit.previous_values->>'model' <> 'gemini-3.1-flash-lite'
     OR v_audit.new_values->>'model' <> 'gemini-2.5-flash'
     OR v_audit.new_values ? 'api_key' THEN
    RAISE EXCEPTION 'audit profilo non coerente';
  END IF;
  BEGIN
    PERFORM public.update_transcription_profile('gemini-2.5-flash', 'extreme', 0.3, 2.5, 'admin-test');
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  BEGIN
    PERFORM public.update_transcription_profile('gemini-2.5-flash', 'low', -1, 2.5, 'admin-test');
  EXCEPTION WHEN check_violation THEN v_failures := v_failures + 1; END;
  IF v_failures <> 2 THEN RAISE EXCEPTION 'vincoli profilo non rispettati: %', v_failures; END IF;
  IF (SELECT count(*) FROM public.transcription_profile_audit) <> 1 THEN
    RAISE EXCEPTION 'un aggiornamento fallito non deve lasciare audit';
  END IF;
  PERFORM public.update_transcription_profile('gemini-3.1-flash-lite', 'minimal', 0.25, 1.5, 'admin-test');
END;
$$;

DROP FUNCTION public.test_rot_claim(UUID, UUID);
DROP FUNCTION public.test_rot_job(INTEGER, UUID);
DROP FUNCTION public.test_assert_true(BOOLEAN, TEXT);
SELECT 'POSTGRES REAL MIGRATION/RPC TESTS PASS' AS result;
