-- Commento didattico:
-- Scopo: abilita la chiave Firecrawl personale nel provider, ledger e job di verifica persistente.
-- Flusso: consente solo Find Tools nel job single-attempt e mantiene ignoti i costi Firecrawl.

ALTER TABLE public.user_provider_credentials
  DROP CONSTRAINT IF EXISTS user_provider_credentials_provider_check;
ALTER TABLE public.user_provider_credentials
  ADD CONSTRAINT user_provider_credentials_provider_check
  CHECK (provider IN ('youtube', 'gemini', 'firecrawl'));

ALTER TABLE public.api_usage_events
  DROP CONSTRAINT IF EXISTS api_usage_events_provider_check;
ALTER TABLE public.api_usage_events
  ADD CONSTRAINT api_usage_events_provider_check
  CHECK (provider IN ('youtube', 'gemini', 'firecrawl'));

CREATE OR REPLACE FUNCTION public.get_my_api_usage_summary(p_since TIMESTAMPTZ)
RETURNS TABLE (
  provider TEXT,
  request_count BIGINT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  total_tokens BIGINT,
  estimated_cost_usd NUMERIC,
  quota_units BIGINT,
  unknown_usage_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    usage.provider,
    COUNT(*)::BIGINT,
    SUM(usage.input_tokens)::BIGINT,
    SUM(usage.output_tokens)::BIGINT,
    SUM(usage.total_tokens)::BIGINT,
    SUM(usage.estimated_cost_usd),
    SUM(usage.quota_units)::BIGINT,
    (COUNT(*) FILTER (
      WHERE (usage.provider = 'gemini' AND (
        usage.input_tokens IS NULL
        OR usage.output_tokens IS NULL
        OR usage.total_tokens IS NULL
        OR usage.estimated_cost_usd IS NULL
      ))
      OR (usage.provider = 'youtube' AND usage.quota_units IS NULL)
      OR usage.provider = 'firecrawl'
    ))::BIGINT
  FROM public.api_usage_events AS usage
  WHERE usage.user_id = (SELECT auth.uid())
    AND usage.occurred_at >= p_since
  GROUP BY usage.provider;
$$;

REVOKE ALL ON FUNCTION public.get_my_api_usage_summary(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_api_usage_summary(TIMESTAMPTZ) TO authenticated;

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
     OR v_provider NOT IN ('youtube', 'gemini', 'firecrawl')
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

REVOKE ALL ON FUNCTION public.claim_credential_validation_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_credential_validation_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  TO service_role;

NOTIFY pgrst, 'reload schema';
