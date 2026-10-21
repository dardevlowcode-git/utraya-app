-- Commento didattico:
-- Scopo: mantenere atomici claim, tentativo e transizioni dei job scan API.
-- Flusso: il worker crea l'attempt running insieme alla lease, poi aggiorna
-- lo stesso attempt a terminale; la recovery chiude attempt abbandonati.

CREATE UNIQUE INDEX IF NOT EXISTS job_attempts_job_attempt_number_uidx
  ON public.job_attempts (job_id, attempt_number);

CREATE OR REPLACE FUNCTION public.claim_scan_job_with_attempt(
  p_job_id UUID,
  p_started_at TIMESTAMPTZ,
  p_lease_id UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS TABLE(job_id UUID, lease_id UUID, attempt_id UUID, attempt_number INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID;
  v_attempt_id UUID;
  v_attempt_number INTEGER;
BEGIN
  IF p_started_at IS NULL
     OR p_lease_id IS NULL
     OR p_lease_expires_at IS NULL
     OR p_lease_expires_at <= pg_catalog.clock_timestamp()
     OR p_lease_expires_at <= p_started_at THEN
    RAISE EXCEPTION 'invalid_scan_job_lease';
  END IF;

  UPDATE public.jobs AS j
  SET status = 'running',
      started_at = p_started_at,
      lease_id = p_lease_id,
      lease_expires_at = p_lease_expires_at,
      completed_at = NULL,
      error_message = NULL
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.status = 'pending'
  RETURNING j.id INTO v_job_id;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(MAX(a.attempt_number), 0) + 1
  INTO v_attempt_number
  FROM public.job_attempts AS a
  WHERE a.job_id = v_job_id;

  INSERT INTO public.job_attempts (
    job_id,
    attempt_number,
    status,
    started_at
  )
  VALUES (
    v_job_id,
    v_attempt_number,
    'running',
    p_started_at
  )
  RETURNING id INTO v_attempt_id;

  job_id := v_job_id;
  lease_id := p_lease_id;
  attempt_id := v_attempt_id;
  attempt_number := v_attempt_number;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_scan_job_attempt(
  p_job_id UUID,
  p_lease_id UUID,
  p_attempt_id UUID,
  p_status TEXT,
  p_completed_at TIMESTAMPTZ,
  p_error_message TEXT,
  p_error_details JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID;
  v_attempt_id UUID;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('completed', 'failed') OR p_completed_at IS NULL THEN
    RAISE EXCEPTION 'invalid_scan_job_terminal_state';
  END IF;

  UPDATE public.jobs AS j
  SET status = p_status,
      completed_at = p_completed_at,
      lease_id = NULL,
      lease_expires_at = NULL,
      error_message = p_error_message
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING j.id INTO v_job_id;

  IF v_job_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.job_attempts AS a
  SET status = p_status,
      completed_at = p_completed_at,
      error_message = p_error_message,
      error_details = p_error_details
  WHERE a.id = p_attempt_id
    AND a.job_id = p_job_id
    AND a.status = 'running'
  RETURNING a.id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'scan_job_attempt_missing';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.requeue_scan_job_if_expired(
  p_job_id UUID,
  p_expected_lease_id UUID,
  p_legacy_cutoff TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID;
  v_error_message TEXT;
  v_recovered_at TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_expected_lease_id IS NULL THEN
    v_error_message := 'requeued_without_lease';
    UPDATE public.jobs AS j
    SET status = 'pending',
        started_at = NULL,
        lease_id = NULL,
        lease_expires_at = NULL,
        completed_at = NULL,
        error_message = v_error_message
    WHERE j.id = p_job_id
      AND j.job_type = 'sync_channel_delta'
      AND j.status = 'running'
      AND j.lease_id IS NULL
      AND j.lease_expires_at IS NULL
      AND p_legacy_cutoff IS NOT NULL
      AND j.started_at < p_legacy_cutoff
    RETURNING j.id INTO v_job_id;
  ELSE
    v_error_message := 'requeued_after_timeout';
    UPDATE public.jobs AS j
    SET status = 'pending',
        started_at = NULL,
        lease_id = NULL,
        lease_expires_at = NULL,
        completed_at = NULL,
        error_message = v_error_message
    WHERE j.id = p_job_id
      AND j.job_type = 'sync_channel_delta'
      AND j.status = 'running'
      AND j.lease_id = p_expected_lease_id
      AND j.lease_expires_at < v_recovered_at
    RETURNING j.id INTO v_job_id;
  END IF;

  IF v_job_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.job_attempts AS a
  SET status = 'failed',
      completed_at = v_recovered_at,
      error_message = v_error_message,
      error_details = pg_catalog.jsonb_build_object('reason', 'lease_recovered')
  WHERE a.job_id = v_job_id
    AND a.status = 'running';

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scan_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_scan_job_attempt(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_scan_job_if_expired(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_scan_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_scan_job_attempt(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_scan_job_if_expired(UUID, UUID, TIMESTAMPTZ)
  TO service_role;
