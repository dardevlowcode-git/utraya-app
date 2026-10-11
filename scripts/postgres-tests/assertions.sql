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

-- Un gate Firecrawl chiuso non deve alimentare placeholder della pipeline transcript legacy.
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
    RAISE EXCEPTION 'closed_firecrawl_gate_created_legacy_transcript_placeholder';
  END IF;
  IF EXISTS (SELECT 1 FROM public.channel_scan_firecrawl_transcript_targets WHERE youtube_video_id = 'yt-new-gate-off') THEN
    RAISE EXCEPTION 'closed_firecrawl_gate_created_recovery_target';
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

-- Canonical import enqueues only a genuinely new video; cached provider replies and transcript writes stay idempotent.
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
  v_claim RECORD;
  v_cached RECORD;
  v_completion JSONB;
  v_video_id UUID;
  v_request_key TEXT := pg_catalog.repeat('b', 64);
  v_rows JSONB := '[
    {"youtube_video_id":"yt-existing","title":"Existing video refreshed","published_at":"2025-01-01T00:00:00Z","video_url":"https://youtube.invalid/watch?v=yt-existing","video_type":"standard","availability_status":"available"},
    {"youtube_video_id":"yt-new","title":"New video","published_at":"2026-01-01T00:00:00Z","video_url":"https://youtube.invalid/watch?v=yt-new","video_type":"standard","availability_status":"available"}
  ]'::JSONB;
BEGIN
  v_import := public.commit_fenced_channel_import(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
    '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004',
    'UC-canonical', 'Canonical channel', '@canonical', '{}'::JSONB, v_rows, 'success', 2
  );
  IF (SELECT count(*) FROM public.channel_scan_firecrawl_transcript_targets
      WHERE job_id = '30000000-0000-4000-8000-000000000006') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.channel_scan_firecrawl_transcript_targets
                    WHERE job_id = '30000000-0000-4000-8000-000000000006' AND youtube_video_id = 'yt-new') THEN
    RAISE EXCEPTION 'new_video_target_enqueue_failed_or_included_existing_video';
  END IF;

  PERFORM public.commit_fenced_channel_import(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
    '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004',
    'UC-canonical', 'Canonical channel', '@canonical', '{}'::JSONB, v_rows, 'success', 2
  );
  IF (SELECT count(*) FROM public.channel_scan_firecrawl_transcript_targets
      WHERE job_id = '30000000-0000-4000-8000-000000000006') <> 1 THEN
    RAISE EXCEPTION 'repeated_canonical_import_duplicated_transcript_target';
  END IF;

  SELECT video_id INTO v_video_id FROM public.channel_scan_firecrawl_transcript_targets
  WHERE job_id = '30000000-0000-4000-8000-000000000006' AND youtube_video_id = 'yt-new';
  SELECT * INTO v_claim FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
    '20000000-0000-4000-8000-000000000004', v_request_key, 'firecrawl'
  );
  IF v_claim.status <> 'assigned' OR v_claim.user_id <> '00000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'firecrawl_request_not_claimed_by_eligible_follower';
  END IF;

  IF NOT public.finish_channel_scan_provider_attempt(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030', v_request_key,
    v_claim.credential_id, v_claim.key_version, 'success', '{"result":"cached synthetic response"}'::JSONB, NULL
  ) THEN RAISE EXCEPTION 'successful_firecrawl_response_not_persisted'; END IF;

  SELECT * INTO v_cached FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
    '20000000-0000-4000-8000-000000000004', v_request_key, 'firecrawl'
  );
  IF v_cached.status <> 'cached' OR v_cached.response->>'result' <> 'cached synthetic response' THEN
    RAISE EXCEPTION 'successful_provider_response_not_reused_canonically';
  END IF;

  v_completion := public.complete_firecrawl_transcript_recovery_target(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
    v_video_id, 'yt-new', 'fetched', 'unknown', 'synthetic test transcript'
  );
  IF v_completion->>'status' <> 'fetched' OR (v_completion->>'hasPending')::BOOLEAN THEN
    RAISE EXCEPTION 'fenced_transcript_completion_failed';
  END IF;

  PERFORM public.commit_fenced_channel_import(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
    '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004',
    'UC-canonical', 'Canonical channel', '@canonical', '{}'::JSONB, v_rows, 'success', 2
  );
  IF (SELECT count(*) FROM public.video_transcripts WHERE youtube_video_id = 'yt-new' AND transcript_status = 'fetched') <> 1
     OR (SELECT count(*) FROM public.channel_scan_firecrawl_transcript_targets
         WHERE youtube_video_id = 'yt-new') <> 1 THEN
    RAISE EXCEPTION 'canonical_transcript_or_target_not_idempotent';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.firecrawl_transcript_recovery_settings SET enabled = FALSE WHERE id = TRUE;
UPDATE public.channel_scan_firecrawl_transcript_targets
SET status = 'pending'
WHERE job_id = '30000000-0000-4000-8000-000000000006' AND youtube_video_id = 'yt-new';
SET ROLE service_role;
DO $$
DECLARE
  v_claim RECORD;
BEGIN
  SELECT * INTO v_claim FROM public.claim_channel_scan_provider_request(
    '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000030',
    '20000000-0000-4000-8000-000000000004', pg_catalog.repeat('d', 64), 'firecrawl'
  );
  IF v_claim.status <> 'disabled' THEN RAISE EXCEPTION 'closed_firecrawl_gate_did_not_block_claim'; END IF;
END;
$$;
RESET ROLE;
UPDATE public.channel_scan_firecrawl_transcript_targets
SET status = 'disabled'
WHERE job_id = '30000000-0000-4000-8000-000000000006' AND youtube_video_id = 'yt-new';
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

DROP FUNCTION public.test_assert_true(BOOLEAN, TEXT);
SELECT 'POSTGRES REAL MIGRATION/RPC TESTS PASS' AS result;
