-- Commento didattico:
-- Scopo: persiste rotazione, budget per richiesta e backoff dei job YouTube.
-- Flusso: gli RPC atomici legano chiavi eleggibili al job; si persistono solo ID,
-- contatori, fingerprint e risposte pubbliche, mai chiavi API o URL provider.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_scan_available
  ON public.jobs (job_type, status, available_at, created_at)
  WHERE job_type = 'sync_channel_delta' AND status = 'pending';

CREATE TABLE IF NOT EXISTS public.channel_scan_key_rotation_cursors (
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'youtube'),
  last_credential_id UUID REFERENCES public.user_provider_credentials(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, provider)
);

CREATE TABLE IF NOT EXISTS public.channel_scan_job_credentials (
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL REFERENCES public.user_provider_credentials(id) ON DELETE CASCADE,
  key_version UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'exhausted', 'ineligible')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, credential_id, key_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_scan_job_one_active_credential
  ON public.channel_scan_job_credentials(job_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.channel_scan_provider_requests (
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL CHECK (request_key ~ '^[0-9a-f]{64}$'),
  credential_id UUID REFERENCES public.user_provider_credentials(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, request_key),
  CHECK ((response IS NULL AND credential_id IS NULL AND user_id IS NULL)
      OR response IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.channel_scan_provider_attempts (
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL CHECK (request_key ~ '^[0-9a-f]{64}$'),
  credential_id UUID NOT NULL REFERENCES public.user_provider_credentials(id) ON DELETE CASCADE,
  key_version UUID NOT NULL,
  retry_limit INTEGER NOT NULL CHECK (retry_limit >= 0),
  attempts_used BIGINT NOT NULL DEFAULT 0 CHECK (attempts_used >= 0),
  retry_at TIMESTAMPTZ,
  last_outcome TEXT NOT NULL CHECK (last_outcome IN ('started', 'success', 'retryable_error', 'ineligible')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, request_key, credential_id, key_version),
  FOREIGN KEY (job_id, request_key)
    REFERENCES public.channel_scan_provider_requests(job_id, request_key) ON DELETE CASCADE
);

ALTER TABLE public.channel_scan_key_rotation_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_scan_job_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_scan_provider_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_scan_provider_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.channel_scan_key_rotation_cursors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.channel_scan_job_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.channel_scan_provider_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.channel_scan_provider_attempts FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.channel_scan_key_rotation_cursors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.channel_scan_job_credentials TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.channel_scan_provider_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.channel_scan_provider_attempts TO service_role;

-- Rispetta la finestra persistente del retry anche quando una route richiama direttamente il claim.
DROP FUNCTION IF EXISTS public.claim_scan_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.claim_scan_job_with_attempt(
  p_job_id UUID,
  p_started_at TIMESTAMPTZ,
  p_lease_id UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS TABLE(job_id UUID, lease_id UUID, attempt_id UUID, attempt_number BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID;
  v_attempt_id UUID;
  v_attempt_number BIGINT;
BEGIN
  IF p_started_at IS NULL OR p_lease_id IS NULL OR p_lease_expires_at IS NULL
     OR p_lease_expires_at <= pg_catalog.clock_timestamp()
     OR p_lease_expires_at <= p_started_at THEN
    RAISE EXCEPTION 'invalid_scan_job_lease';
  END IF;

  UPDATE public.jobs AS j
  SET status = 'running',
      started_at = p_started_at,
      lease_id = p_lease_id,
      lease_expires_at = p_lease_expires_at,
      available_at = NULL,
      completed_at = NULL,
      error_message = NULL
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.status = 'pending'
    AND (j.available_at IS NULL OR j.available_at <= pg_catalog.clock_timestamp())
  RETURNING j.id INTO v_job_id;

  IF v_job_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(MAX(a.attempt_number), 0) + 1
  INTO v_attempt_number
  FROM public.job_attempts AS a
  WHERE a.job_id = v_job_id;

  INSERT INTO public.job_attempts(job_id, attempt_number, status, started_at)
  VALUES (v_job_id, v_attempt_number, 'running', p_started_at)
  RETURNING id INTO v_attempt_id;

  job_id := v_job_id;
  lease_id := p_lease_id;
  attempt_id := v_attempt_id;
  attempt_number := v_attempt_number;
  RETURN NEXT;
END;
$$;

-- Claim concorrente: fissa un follower e incrementa il contatore prima della chiamata esterna.
CREATE OR REPLACE FUNCTION public.claim_channel_scan_provider_request(
  p_job_id UUID,
  p_lease_id UUID,
  p_channel_id UUID,
  p_request_key TEXT
)
RETURNS TABLE(
  status TEXT,
  credential_id UUID,
  user_id UUID,
  key_version UUID,
  retry_limit INTEGER,
  attempt_number BIGINT,
  retry_at TIMESTAMPTZ,
  response JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cursor_credential UUID;
  v_credential_id UUID;
  v_user_id UUID;
  v_key_version UUID;
  v_retry_limit INTEGER;
  v_attempt_number BIGINT;
  v_attempt_retry_limit INTEGER;
  v_retry_at TIMESTAMPTZ;
  v_response JSONB;
  v_eligible_count INTEGER;
BEGIN
  IF p_request_key IS NULL OR p_request_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_channel_scan_request_key';
  END IF;

  PERFORM 1
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.payload->>'channelId' = p_channel_id::TEXT
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scan_job_lease_lost'; END IF;

  SELECT r.response, r.credential_id, r.user_id
  INTO v_response, v_credential_id, v_user_id
  FROM public.channel_scan_provider_requests AS r
  WHERE r.job_id = p_job_id AND r.request_key = p_request_key;
  IF FOUND AND v_response IS NOT NULL THEN
    status := 'cached';
    credential_id := v_credential_id;
    user_id := v_user_id;
    key_version := NULL;
    retry_limit := NULL;
    attempt_number := NULL;
    retry_at := NULL;
    response := v_response;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.channel_scan_provider_requests(job_id, request_key)
  VALUES (p_job_id, p_request_key)
  ON CONFLICT (job_id, request_key) DO NOTHING;

  INSERT INTO public.channel_scan_key_rotation_cursors(channel_id, provider)
  VALUES (p_channel_id, 'youtube')
  ON CONFLICT (channel_id, provider) DO NOTHING;

  SELECT c.last_credential_id
  INTO v_cursor_credential
  FROM public.channel_scan_key_rotation_cursors AS c
  WHERE c.channel_id = p_channel_id AND c.provider = 'youtube'
  FOR UPDATE;

  SELECT COUNT(*)::INTEGER
  INTO v_eligible_count
  FROM public.user_channels AS uc
  JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = 'youtube'
  JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
  WHERE uc.channel_id = p_channel_id
    AND uc.is_active = TRUE
    AND c.is_configured = TRUE
    AND c.encrypted_key IS NOT NULL
    AND c.is_valid IS DISTINCT FROM FALSE;

  IF v_eligible_count = 0 THEN
    status := 'waiting';
    credential_id := NULL;
    user_id := NULL;
    key_version := NULL;
    retry_limit := NULL;
    attempt_number := NULL;
    retry_at := NULL;
    response := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  LOOP
    v_credential_id := NULL;
    v_user_id := NULL;
    v_key_version := NULL;
    v_retry_limit := NULL;

    SELECT jk.credential_id, c.user_id, jk.key_version, l.retry_limit
    INTO v_credential_id, v_user_id, v_key_version, v_retry_limit
    FROM public.channel_scan_job_credentials AS jk
    JOIN public.user_provider_credentials AS c ON c.id = jk.credential_id
    JOIN public.user_channels AS uc ON uc.user_id = c.user_id
      AND uc.channel_id = p_channel_id AND uc.is_active = TRUE
    JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
      AND l.key_version = jk.key_version
    WHERE jk.job_id = p_job_id
      AND jk.status = 'active'
      AND c.provider = 'youtube'
      AND c.is_configured = TRUE
      AND c.encrypted_key IS NOT NULL
      AND c.is_valid IS DISTINCT FROM FALSE
    ORDER BY jk.assigned_at DESC
    LIMIT 1
    FOR UPDATE OF jk;

    IF v_credential_id IS NULL THEN
      UPDATE public.channel_scan_job_credentials AS jk
      SET status = 'ineligible', updated_at = pg_catalog.clock_timestamp()
      WHERE jk.job_id = p_job_id
        AND jk.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM public.user_provider_credentials AS c
          JOIN public.user_channels AS uc ON uc.user_id = c.user_id
          JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
          WHERE c.id = jk.credential_id
            AND c.provider = 'youtube'
            AND c.is_configured = TRUE
            AND c.encrypted_key IS NOT NULL
            AND c.is_valid IS DISTINCT FROM FALSE
            AND uc.channel_id = p_channel_id
            AND uc.is_active = TRUE
            AND l.key_version = jk.key_version
        );

      WITH eligible AS (
        SELECT c.id AS credential_id,
               c.user_id,
               l.key_version,
               uc.added_at,
               l.retry_limit,
               pg_catalog.row_number() OVER (ORDER BY uc.added_at, uc.user_id, c.id) AS position
        FROM public.user_channels AS uc
        JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = 'youtube'
        JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
        WHERE uc.channel_id = p_channel_id
          AND uc.is_active = TRUE
          AND c.is_configured = TRUE
          AND c.encrypted_key IS NOT NULL
          AND c.is_valid IS DISTINCT FROM FALSE
      ), cursor_follower AS (
        SELECT uc.added_at, uc.user_id, c.id AS credential_id
        FROM public.user_provider_credentials AS c
        JOIN public.user_channels AS uc ON uc.user_id = c.user_id
        WHERE c.id = v_cursor_credential
          AND c.provider = 'youtube'
          AND uc.channel_id = p_channel_id
          AND uc.is_active = TRUE
      ), anchor AS (
        SELECT (
          SELECT COUNT(*)::BIGINT
          FROM eligible AS e
          WHERE (e.added_at, e.user_id, e.credential_id)
            <= (f.added_at, f.user_id, f.credential_id)
        ) AS position
        FROM cursor_follower AS f
      )
      SELECT e.credential_id, e.user_id, e.key_version, e.retry_limit
      INTO v_credential_id, v_user_id, v_key_version, v_retry_limit
      FROM eligible AS e
      LEFT JOIN public.channel_scan_job_credentials AS jk
        ON jk.job_id = p_job_id AND jk.credential_id = e.credential_id
        AND jk.key_version = e.key_version
      LEFT JOIN anchor AS a ON TRUE
      WHERE jk.credential_id IS NULL
      ORDER BY CASE WHEN a.position IS NULL OR e.position > a.position THEN 0 ELSE 1 END,
               e.position
      LIMIT 1;

      IF v_credential_id IS NULL THEN
        SELECT COUNT(*)::INTEGER
        INTO v_eligible_count
        FROM public.user_channels AS uc
        JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = 'youtube'
        JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
        WHERE uc.channel_id = p_channel_id
          AND uc.is_active = TRUE
          AND c.is_configured = TRUE
          AND c.encrypted_key IS NOT NULL
          AND c.is_valid IS DISTINCT FROM FALSE;

        IF v_eligible_count = 0 THEN
          status := 'waiting';
          credential_id := NULL;
          user_id := NULL;
          key_version := NULL;
          retry_limit := NULL;
          attempt_number := NULL;
          retry_at := NULL;
          response := NULL;
          RETURN NEXT;
          RETURN;
        END IF;

        status := 'exhausted';
        credential_id := NULL;
        user_id := NULL;
        key_version := NULL;
        retry_limit := NULL;
        attempt_number := NULL;
        retry_at := NULL;
        response := NULL;
        RETURN NEXT;
        RETURN;
      END IF;

      INSERT INTO public.channel_scan_job_credentials(job_id, credential_id, key_version, status)
      VALUES (p_job_id, v_credential_id, v_key_version, 'active');

      UPDATE public.channel_scan_key_rotation_cursors AS c
      SET last_credential_id = v_credential_id,
          updated_at = pg_catalog.clock_timestamp()
      WHERE c.channel_id = p_channel_id AND c.provider = 'youtube';
    END IF;

    INSERT INTO public.channel_scan_provider_attempts(
      job_id, request_key, credential_id, key_version, retry_limit, attempts_used, last_outcome
    )
    VALUES (p_job_id, p_request_key, v_credential_id, v_key_version, v_retry_limit, 0, 'started')
    ON CONFLICT (job_id, request_key, credential_id, key_version) DO NOTHING;

    SELECT a.retry_limit, a.attempts_used, a.retry_at
    INTO v_attempt_retry_limit, v_attempt_number, v_retry_at
    FROM public.channel_scan_provider_attempts AS a
    WHERE a.job_id = p_job_id
      AND a.request_key = p_request_key
      AND a.credential_id = v_credential_id
      AND a.key_version = v_key_version
    FOR UPDATE;

    IF v_attempt_number >= v_attempt_retry_limit::BIGINT + 1 THEN
      UPDATE public.channel_scan_job_credentials AS jk
      SET status = 'exhausted', updated_at = pg_catalog.clock_timestamp()
      WHERE jk.job_id = p_job_id AND jk.credential_id = v_credential_id
        AND jk.key_version = v_key_version AND jk.status = 'active';
      CONTINUE;
    END IF;

    IF v_retry_at IS NOT NULL AND v_retry_at > pg_catalog.clock_timestamp() THEN
      status := 'backoff';
      credential_id := v_credential_id;
      user_id := v_user_id;
      key_version := v_key_version;
      retry_limit := v_attempt_retry_limit;
      attempt_number := v_attempt_number;
      retry_at := v_retry_at;
      response := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    UPDATE public.channel_scan_provider_attempts AS a
    SET attempts_used = a.attempts_used + 1,
        retry_at = NULL,
        last_outcome = 'started',
        updated_at = pg_catalog.clock_timestamp()
    WHERE a.job_id = p_job_id
      AND a.request_key = p_request_key
      AND a.credential_id = v_credential_id
      AND a.key_version = v_key_version
    RETURNING a.attempts_used INTO v_attempt_number;

    status := 'assigned';
    credential_id := v_credential_id;
    user_id := v_user_id;
    key_version := v_key_version;
    retry_limit := v_attempt_retry_limit;
    attempt_number := v_attempt_number;
    retry_at := NULL;
    response := NULL;
    RETURN NEXT;
    RETURN;
  END LOOP;
END;
$$;

-- Fissa il payload pubblico per evitare di ripetere endpoint già riusciti dopo recovery.
CREATE OR REPLACE FUNCTION public.finish_channel_scan_provider_attempt(
  p_job_id UUID,
  p_lease_id UUID,
  p_request_key TEXT,
  p_credential_id UUID,
  p_key_version UUID,
  p_outcome TEXT,
  p_response JSONB,
  p_retry_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts_used BIGINT;
  v_retry_limit INTEGER;
  v_user_id UUID;
BEGIN
  IF p_key_version IS NULL OR p_outcome NOT IN ('success', 'retryable_error', 'ineligible') THEN
    RAISE EXCEPTION 'invalid_channel_scan_provider_outcome';
  END IF;

  PERFORM 1
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.channel_scan_provider_attempts AS a
  SET last_outcome = p_outcome,
      retry_at = CASE WHEN p_outcome = 'retryable_error' THEN p_retry_at ELSE NULL END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE a.job_id = p_job_id
    AND a.request_key = p_request_key
    AND a.credential_id = p_credential_id
    AND a.key_version = p_key_version
  RETURNING a.attempts_used, a.retry_limit INTO v_attempts_used, v_retry_limit;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel_scan_provider_attempt_missing'; END IF;

  SELECT c.user_id INTO v_user_id
  FROM public.user_provider_credentials AS c
  WHERE c.id = p_credential_id;

  IF p_outcome = 'success' THEN
    IF p_response IS NULL THEN RAISE EXCEPTION 'channel_scan_response_missing'; END IF;
    UPDATE public.channel_scan_provider_requests AS r
    SET credential_id = p_credential_id,
        user_id = v_user_id,
        response = p_response,
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.job_id = p_job_id AND r.request_key = p_request_key;

    UPDATE public.user_provider_credentials
    SET is_valid = TRUE,
        last_used_at = pg_catalog.clock_timestamp(),
        last_error = NULL
    WHERE id = p_credential_id
      AND EXISTS (
        SELECT 1 FROM public.user_provider_credential_retry_limits AS l
        WHERE l.credential_id = p_credential_id AND l.key_version = p_key_version
      );
  ELSIF p_outcome = 'retryable_error' THEN
    UPDATE public.user_provider_credentials
    SET last_used_at = pg_catalog.clock_timestamp()
    WHERE id = p_credential_id
      AND EXISTS (
        SELECT 1 FROM public.user_provider_credential_retry_limits AS l
        WHERE l.credential_id = p_credential_id AND l.key_version = p_key_version
      );

    IF v_attempts_used >= v_retry_limit::BIGINT + 1 THEN
      UPDATE public.channel_scan_job_credentials AS jk
      SET status = 'exhausted', updated_at = pg_catalog.clock_timestamp()
      WHERE jk.job_id = p_job_id AND jk.credential_id = p_credential_id
        AND jk.key_version = p_key_version AND jk.status = 'active';
    END IF;
  ELSIF p_outcome = 'ineligible' THEN
    UPDATE public.channel_scan_provider_attempts AS a
    SET attempts_used = GREATEST(a.attempts_used - 1, 0),
        updated_at = pg_catalog.clock_timestamp()
    WHERE a.job_id = p_job_id
      AND a.request_key = p_request_key
      AND a.credential_id = p_credential_id
      AND a.key_version = p_key_version;

    UPDATE public.channel_scan_job_credentials AS jk
    SET status = 'ineligible', updated_at = pg_catalog.clock_timestamp()
    WHERE jk.job_id = p_job_id AND jk.credential_id = p_credential_id
      AND jk.key_version = p_key_version AND jk.status = 'active';
  END IF;

  RETURN TRUE;
END;
$$;

-- Job defer e attempt terminale restano atomici, ma il ciclo del job rimane pending.
CREATE OR REPLACE FUNCTION public.defer_scan_job_attempt(
  p_job_id UUID,
  p_lease_id UUID,
  p_attempt_id UUID,
  p_available_at TIMESTAMPTZ,
  p_reason TEXT,
  p_completed_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_id UUID;
  v_attempt_id UUID;
  v_available_at TIMESTAMPTZ;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('waiting_for_credential', 'provider_retry_backoff', 'advance_to_next_credential', 'provider_request_checkpoint')
     OR p_completed_at IS NULL
     OR (p_available_at IS NOT NULL AND p_available_at < p_completed_at) THEN
    RAISE EXCEPTION 'invalid_scan_job_defer_state';
  END IF;

  v_available_at := CASE
    WHEN p_reason = 'waiting_for_credential' AND p_available_at IS NULL
      THEN pg_catalog.clock_timestamp() + INTERVAL '1 hour'
    ELSE p_available_at
  END;

  UPDATE public.jobs AS j
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = CASE WHEN p_reason = 'provider_request_checkpoint' THEN NULL ELSE p_reason END,
      lease_id = NULL,
      lease_expires_at = NULL,
      available_at = v_available_at
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING j.id INTO v_job_id;
  IF v_job_id IS NULL THEN RETURN FALSE; END IF;

  UPDATE public.job_attempts AS a
  SET status = CASE WHEN p_reason = 'provider_request_checkpoint' THEN 'completed' ELSE 'failed' END,
      completed_at = p_completed_at,
      error_message = CASE WHEN p_reason = 'provider_request_checkpoint' THEN NULL ELSE p_reason END,
      error_details = pg_catalog.jsonb_build_object(
        'reason', p_reason,
        'available_at', v_available_at,
        'provider_request_checkpoint', p_reason = 'provider_request_checkpoint'
      )
  WHERE a.id = p_attempt_id AND a.job_id = p_job_id AND a.status = 'running'
  RETURNING a.id INTO v_attempt_id;
  IF v_attempt_id IS NULL THEN RAISE EXCEPTION 'scan_job_attempt_missing'; END IF;

  RETURN TRUE;
END;
$$;

-- Rimuove i payload di risposta alla chiusura del job, mantenendo solo i contatori auditabili.
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
      available_at = NULL,
      error_message = p_error_message
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING j.id INTO v_job_id;
  IF v_job_id IS NULL THEN RETURN FALSE; END IF;

  UPDATE public.job_attempts AS a
  SET status = p_status,
      completed_at = p_completed_at,
      error_message = p_error_message,
      error_details = p_error_details
  WHERE a.id = p_attempt_id AND a.job_id = p_job_id AND a.status = 'running'
  RETURNING a.id INTO v_attempt_id;
  IF v_attempt_id IS NULL THEN RAISE EXCEPTION 'scan_job_attempt_missing'; END IF;

  UPDATE public.channel_scan_provider_requests AS r
  SET credential_id = NULL,
      user_id = NULL,
      response = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE r.job_id = p_job_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_channel_scan_provider_request(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_channel_scan_provider_attempt(UUID, UUID, TEXT, UUID, UUID, TEXT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_scan_job_attempt(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_scan_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_scan_job_attempt(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_channel_scan_provider_request(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_channel_scan_provider_attempt(UUID, UUID, TEXT, UUID, UUID, TEXT, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_scan_job_attempt(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_scan_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_scan_job_attempt(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB) TO service_role;
