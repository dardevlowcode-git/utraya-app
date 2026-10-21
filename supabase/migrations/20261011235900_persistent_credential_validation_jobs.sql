-- Commento didattico:
-- Scopo del file: prosegue le validazioni chiave con job/attempt/lease esistenti senza cicli nella request.
-- Flusso: ogni lease prenota una richiesta same-key; retry time, key version e contatore sopravvivono al recovery.

ALTER TABLE public.user_provider_credential_retry_limits
  ADD COLUMN IF NOT EXISTS key_version UUID NOT NULL DEFAULT uuid_generate_v4();

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE public.job_attempts
  ALTER COLUMN attempt_number TYPE BIGINT USING attempt_number::BIGINT;

CREATE INDEX IF NOT EXISTS idx_jobs_credential_validation_due
  ON public.jobs (next_attempt_at, created_at)
  WHERE job_type = 'validate_provider_credential'
    AND status IN ('pending', 'running');

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_credential_validation_version
  ON public.jobs ((payload->>'credentialId'), (payload->>'keyVersion'))
  WHERE job_type = 'validate_provider_credential'
    AND status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION public.claim_credential_validation_job_with_attempt(
  p_job_id UUID,
  p_started_at TIMESTAMPTZ,
  p_lease_id UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS TABLE(
  job_id UUID,
  lease_id UUID,
  attempt_id UUID,
  attempt_number BIGINT,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_attempt_id UUID;
  v_attempt_number BIGINT;
  v_retry_limit BIGINT;
  v_credential_id UUID;
  v_user_id UUID;
  v_provider TEXT;
  v_key_version UUID;
  v_current_key_version UUID;
  v_is_configured BOOLEAN;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_has_retry_setting BOOLEAN;
  v_has_credential BOOLEAN;
BEGIN
  IF p_started_at IS NULL
     OR p_lease_id IS NULL
     OR p_lease_expires_at IS NULL
     OR p_lease_expires_at <= v_now
     OR p_lease_expires_at <= p_started_at THEN
    RAISE EXCEPTION 'invalid_credential_validation_lease';
  END IF;

  SELECT j.* INTO v_job
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.job_type = 'validate_provider_credential'
    AND (
      (j.status = 'pending' AND j.next_attempt_at <= v_now)
      OR (j.status = 'running' AND j.lease_expires_at < v_now)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_job.status = 'running' THEN
    UPDATE public.job_attempts AS a
    SET status = 'failed',
        completed_at = v_now,
        error_message = 'validation_lease_expired',
        error_details = pg_catalog.jsonb_build_object('reason', 'lease_recovered')
    WHERE a.job_id = v_job.id AND a.status = 'running';
  END IF;

  BEGIN
    v_credential_id := (v_job.payload->>'credentialId')::UUID;
    v_user_id := (v_job.payload->>'userId')::UUID;
    v_provider := v_job.payload->>'provider';
    v_key_version := (v_job.payload->>'keyVersion')::UUID;
    v_retry_limit := (v_job.payload->>'retryLimit')::BIGINT;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    UPDATE public.jobs
    SET status = 'failed', completed_at = v_now, next_attempt_at = NULL,
        lease_id = NULL, lease_expires_at = NULL,
        error_message = 'invalid_validation_payload'
    WHERE id = v_job.id;
    RETURN;
  END;

  IF v_credential_id IS NULL
     OR v_user_id IS NULL
     OR v_key_version IS NULL
     OR v_provider IS NULL
     OR v_provider NOT IN ('youtube', 'gemini')
     OR v_retry_limit IS NULL
     OR v_retry_limit < 0
     OR v_retry_limit > 2147483647 THEN
    UPDATE public.jobs
    SET status = 'failed', completed_at = v_now, next_attempt_at = NULL,
        lease_id = NULL, lease_expires_at = NULL,
        error_message = 'invalid_validation_payload'
    WHERE id = v_job.id;
    RETURN;
  END IF;

  -- Stessa lock order del save: retry setting/key version, poi credential.
  SELECT r.key_version INTO v_current_key_version
  FROM public.user_provider_credential_retry_limits AS r
  WHERE r.credential_id = v_credential_id
  FOR UPDATE;
  v_has_retry_setting := FOUND;

  SELECT c.is_configured INTO v_is_configured
  FROM public.user_provider_credentials AS c
  WHERE c.id = v_credential_id
    AND c.user_id = v_user_id
    AND c.provider = v_provider
  FOR UPDATE;
  v_has_credential := FOUND;

  IF NOT v_has_retry_setting
     OR NOT v_has_credential
     OR NOT v_is_configured
     OR v_current_key_version <> v_key_version THEN
    UPDATE public.jobs
    SET status = 'failed', completed_at = v_now, next_attempt_at = NULL,
        lease_id = NULL, lease_expires_at = NULL,
        error_message = 'credential_changed'
    WHERE id = v_job.id;
    RETURN;
  END IF;

  SELECT COALESCE(pg_catalog.max(a.attempt_number), 0)
  INTO v_attempt_number
  FROM public.job_attempts AS a
  WHERE a.job_id = v_job.id;

  -- Un attempt scaduto conta come prenotato: non riaprire un budget esaurito.
  IF v_attempt_number >= v_retry_limit + 1 THEN
    UPDATE public.jobs
    SET status = 'failed', completed_at = v_now, next_attempt_at = NULL,
        lease_id = NULL, lease_expires_at = NULL,
        error_message = 'validation_retry_budget_exhausted'
    WHERE id = v_job.id;

    UPDATE public.user_provider_credentials AS c
    SET is_valid = FALSE, last_validated_at = v_now,
        last_error = 'validation_retry_budget_exhausted'
    WHERE c.id = v_credential_id AND c.user_id = v_user_id AND c.provider = v_provider;

    INSERT INTO public.credential_checks (credential_id, is_valid, error_message, error_type)
    VALUES (v_credential_id, FALSE, 'validation_retry_budget_exhausted', 'temporary');
    RETURN;
  END IF;

  v_attempt_number := v_attempt_number + 1;
  UPDATE public.jobs
  SET status = 'running', started_at = p_started_at,
      lease_id = p_lease_id, lease_expires_at = p_lease_expires_at,
      completed_at = NULL, next_attempt_at = NULL, error_message = NULL
  WHERE id = v_job.id;

  INSERT INTO public.job_attempts (job_id, attempt_number, status, started_at)
  VALUES (v_job.id, v_attempt_number, 'running', p_started_at)
  RETURNING id INTO v_attempt_id;

  job_id := v_job.id;
  lease_id := p_lease_id;
  attempt_id := v_attempt_id;
  attempt_number := v_attempt_number;
  payload := v_job.payload;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_credential_validation_job_attempt(
  p_job_id UUID,
  p_lease_id UUID,
  p_attempt_id UUID,
  p_attempt_number BIGINT,
  p_retry_limit BIGINT,
  p_status TEXT,
  p_completed_at TIMESTAMPTZ,
  p_next_attempt_at TIMESTAMPTZ,
  p_is_valid BOOLEAN,
  p_error_message TEXT,
  p_error_type TEXT,
  p_credential_changed BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_attempt public.job_attempts%ROWTYPE;
  v_credential_id UUID;
  v_user_id UUID;
  v_provider TEXT;
  v_key_version UUID;
  v_payload_retry_limit BIGINT;
  v_current_key_version UUID;
  v_is_configured BOOLEAN;
  v_has_retry_setting BOOLEAN;
  v_has_credential BOOLEAN;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'completed', 'failed')
     OR p_completed_at IS NULL OR p_attempt_number IS NULL OR p_attempt_number < 1
     OR p_retry_limit < 0 OR p_retry_limit > 2147483647
     OR p_retry_limit IS NULL OR p_is_valid IS NULL OR p_credential_changed IS NULL
     OR (p_error_type IS NOT NULL AND p_error_type NOT IN ('temporary', 'structural')) THEN
    RAISE EXCEPTION 'invalid_credential_validation_result';
  END IF;

  SELECT j.* INTO v_job
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.job_type = 'validate_provider_credential'
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT a.* INTO v_attempt
  FROM public.job_attempts AS a
  WHERE a.id = p_attempt_id
    AND a.job_id = p_job_id
    AND a.attempt_number = p_attempt_number
    AND a.status = 'running'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credential_validation_attempt_missing';
  END IF;

  BEGIN
    v_credential_id := (v_job.payload->>'credentialId')::UUID;
    v_user_id := (v_job.payload->>'userId')::UUID;
    v_provider := v_job.payload->>'provider';
    v_key_version := (v_job.payload->>'keyVersion')::UUID;
    v_payload_retry_limit := (v_job.payload->>'retryLimit')::BIGINT;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_credential_validation_payload';
  END;

  IF v_payload_retry_limit IS DISTINCT FROM p_retry_limit
     OR p_status = 'pending' AND (p_attempt_number > p_retry_limit OR p_next_attempt_at IS NULL OR p_next_attempt_at <= p_completed_at)
     OR p_status <> 'pending' AND p_next_attempt_at IS NOT NULL THEN
    RAISE EXCEPTION 'credential_validation_budget_mismatch';
  END IF;

  -- Stessa lock order del save impedisce che un risultato vecchio aggiorni una chiave sostituita.
  SELECT r.key_version INTO v_current_key_version
  FROM public.user_provider_credential_retry_limits AS r
  WHERE r.credential_id = v_credential_id
  FOR UPDATE;
  v_has_retry_setting := FOUND;

  SELECT c.is_configured INTO v_is_configured
  FROM public.user_provider_credentials AS c
  WHERE c.id = v_credential_id
    AND c.user_id = v_user_id
    AND c.provider = v_provider
  FOR UPDATE;
  v_has_credential := FOUND;

  IF p_credential_changed OR NOT v_has_retry_setting OR NOT v_has_credential
     OR NOT v_is_configured OR v_current_key_version <> v_key_version THEN
    p_status := 'failed';
    p_error_message := 'credential_changed';
    p_is_valid := FALSE;
    p_error_type := 'structural';
    p_next_attempt_at := NULL;
  END IF;

  UPDATE public.job_attempts AS a
  SET status = CASE WHEN p_status = 'completed' THEN 'completed' ELSE 'failed' END,
      completed_at = p_completed_at,
      error_message = p_error_message,
      error_details = pg_catalog.jsonb_build_object(
        'status', p_status,
        'retryable', p_status = 'pending',
        'attemptNumber', p_attempt_number
      )
  WHERE a.id = p_attempt_id AND a.job_id = p_job_id AND a.status = 'running';

  UPDATE public.jobs AS j
  SET status = p_status,
      completed_at = CASE WHEN p_status = 'pending' THEN NULL ELSE p_completed_at END,
      next_attempt_at = p_next_attempt_at,
      lease_id = NULL,
      lease_expires_at = NULL,
      error_message = p_error_message
  WHERE j.id = p_job_id AND j.status = 'running' AND j.lease_id = p_lease_id;

  IF p_status <> 'pending' AND v_has_retry_setting AND v_has_credential
     AND v_is_configured AND v_current_key_version = v_key_version
     AND NOT p_credential_changed THEN
    UPDATE public.user_provider_credentials AS c
    SET is_valid = p_is_valid,
        last_validated_at = p_completed_at,
        last_error = p_error_message
    WHERE c.id = v_credential_id AND c.user_id = v_user_id AND c.provider = v_provider;

    INSERT INTO public.credential_checks (credential_id, is_valid, error_message, error_type)
    VALUES (v_credential_id, p_is_valid, p_error_message, p_error_type);
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_credential_validation_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_credential_validation_job_attempt(UUID, UUID, UUID, BIGINT, BIGINT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_credential_validation_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_credential_validation_job_attempt(UUID, UUID, UUID, BIGINT, BIGINT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TEXT, BOOLEAN)
  TO service_role;
