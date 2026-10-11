-- Commento didattico:
-- Scopo: collega il recupero transcript Firecrawl ai claim/lease e ai budget provider gia` persistenti.
-- Flusso: un gate globale spento blocca enqueue, claim e scrittura; solo video realmente nuovi diventano target.

-- Gate distinto dal cron transcript legacy: una riga mancante equivale a disabilitato.
CREATE TABLE IF NOT EXISTS public.firecrawl_transcript_recovery_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.firecrawl_transcript_recovery_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.firecrawl_transcript_recovery_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.firecrawl_transcript_recovery_settings TO service_role;

INSERT INTO public.firecrawl_transcript_recovery_settings (id, enabled)
VALUES (TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER firecrawl_transcript_recovery_settings_updated_at
  BEFORE UPDATE ON public.firecrawl_transcript_recovery_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.channel_scan_firecrawl_transcript_targets (
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fetched', 'missing', 'skipped', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, video_id),
  UNIQUE (video_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_scan_firecrawl_transcript_pending
  ON public.channel_scan_firecrawl_transcript_targets (job_id, created_at)
  WHERE status = 'pending';

CREATE TRIGGER channel_scan_firecrawl_transcript_targets_updated_at
  BEFORE UPDATE ON public.channel_scan_firecrawl_transcript_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.channel_scan_firecrawl_transcript_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.channel_scan_firecrawl_transcript_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.channel_scan_firecrawl_transcript_targets TO service_role;

-- Riuso delle tabelle esistenti: cursori e credenziali sono indipendenti per provider.
ALTER TABLE public.channel_scan_key_rotation_cursors
  DROP CONSTRAINT IF EXISTS channel_scan_key_rotation_cursors_provider_check;
ALTER TABLE public.channel_scan_key_rotation_cursors
  ADD CONSTRAINT channel_scan_key_rotation_cursors_provider_check
  CHECK (provider IN ('youtube', 'firecrawl'));

ALTER TABLE public.channel_scan_job_credentials
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE public.channel_scan_job_credentials
  DROP CONSTRAINT IF EXISTS channel_scan_job_credentials_provider_check;
ALTER TABLE public.channel_scan_job_credentials
  ADD CONSTRAINT channel_scan_job_credentials_provider_check
  CHECK (provider IN ('youtube', 'firecrawl'));
DROP INDEX IF EXISTS public.idx_channel_scan_job_one_active_credential;
ALTER TABLE public.channel_scan_job_credentials
  DROP CONSTRAINT IF EXISTS channel_scan_job_credentials_pkey;
ALTER TABLE public.channel_scan_job_credentials
  ADD CONSTRAINT channel_scan_job_credentials_pkey
  PRIMARY KEY (job_id, provider, credential_id, key_version);
CREATE UNIQUE INDEX idx_channel_scan_job_one_active_credential
  ON public.channel_scan_job_credentials(job_id, provider)
  WHERE status = 'active';

ALTER TABLE public.channel_scan_provider_requests
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE public.channel_scan_provider_requests
  DROP CONSTRAINT IF EXISTS channel_scan_provider_requests_provider_check;
ALTER TABLE public.channel_scan_provider_requests
  ADD CONSTRAINT channel_scan_provider_requests_provider_check
  CHECK (provider IN ('youtube', 'firecrawl'));

DROP FUNCTION IF EXISTS public.claim_channel_scan_provider_request(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.claim_channel_scan_provider_request(
  p_job_id UUID,
  p_lease_id UUID,
  p_channel_id UUID,
  p_request_key TEXT,
  p_provider TEXT
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
  v_request_provider TEXT;
  v_eligible_count INTEGER;
BEGIN
  IF p_request_key IS NULL OR p_request_key !~ '^[0-9a-f]{64}$'
     OR p_provider IS NULL OR p_provider NOT IN ('youtube', 'firecrawl') THEN
    RAISE EXCEPTION 'invalid_channel_scan_provider_request';
  END IF;

  PERFORM 1
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND (
      j.payload->>'channelId' = p_channel_id::TEXT
      OR (p_provider = 'firecrawl' AND EXISTS (
        SELECT 1 FROM public.channel_scan_firecrawl_transcript_targets AS target
        WHERE target.job_id = j.id AND target.channel_id = p_channel_id AND target.status = 'pending'
      ))
    )
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scan_job_lease_lost'; END IF;

  IF p_provider = 'firecrawl'
     AND NOT EXISTS (
       SELECT 1 FROM public.firecrawl_transcript_recovery_settings AS s
       WHERE s.id = TRUE AND s.enabled = TRUE
     ) THEN
    status := 'disabled';
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

  SELECT r.response, r.credential_id, r.user_id, r.provider
  INTO v_response, v_credential_id, v_user_id, v_request_provider
  FROM public.channel_scan_provider_requests AS r
  WHERE r.job_id = p_job_id AND r.request_key = p_request_key;
  IF FOUND AND v_request_provider <> p_provider THEN
    RAISE EXCEPTION 'channel_scan_provider_request_mismatch';
  END IF;
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

  INSERT INTO public.channel_scan_provider_requests(job_id, request_key, provider)
  VALUES (p_job_id, p_request_key, p_provider)
  ON CONFLICT (job_id, request_key) DO NOTHING;

  INSERT INTO public.channel_scan_key_rotation_cursors(channel_id, provider)
  VALUES (p_channel_id, p_provider)
  ON CONFLICT (channel_id, provider) DO NOTHING;

  SELECT c.last_credential_id
  INTO v_cursor_credential
  FROM public.channel_scan_key_rotation_cursors AS c
  WHERE c.channel_id = p_channel_id AND c.provider = p_provider
  FOR UPDATE;

  SELECT COUNT(*)::INTEGER
  INTO v_eligible_count
  FROM public.user_channels AS uc
  JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = p_provider
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
      AND jk.provider = p_provider
      AND jk.status = 'active'
      AND c.provider = p_provider
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
        AND jk.provider = p_provider
        AND jk.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM public.user_provider_credentials AS c
          JOIN public.user_channels AS uc ON uc.user_id = c.user_id
          JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
          WHERE c.id = jk.credential_id
            AND c.provider = p_provider
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
        JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = p_provider
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
          AND c.provider = p_provider
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
        ON jk.job_id = p_job_id
        AND jk.provider = p_provider
        AND jk.credential_id = e.credential_id
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
        JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = p_provider
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

      INSERT INTO public.channel_scan_job_credentials(job_id, provider, credential_id, key_version, status)
      VALUES (p_job_id, p_provider, v_credential_id, v_key_version, 'active');

      UPDATE public.channel_scan_key_rotation_cursors AS c
      SET last_credential_id = v_credential_id,
          updated_at = pg_catalog.clock_timestamp()
      WHERE c.channel_id = p_channel_id AND c.provider = p_provider;
    END IF;

    INSERT INTO public.channel_scan_provider_attempts(
      job_id, request_key, credential_id, key_version, retry_limit, attempts_used, last_outcome
    )
    VALUES (p_job_id, p_request_key, v_credential_id, v_key_version, v_retry_limit, 0, 'started')
    ON CONFLICT ON CONSTRAINT channel_scan_provider_attempts_pkey DO NOTHING;

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
      WHERE jk.job_id = p_job_id AND jk.provider = p_provider
        AND jk.credential_id = v_credential_id
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

-- Compatibilita` col worker YouTube: nessuna policy separata, provider imposto a youtube.
CREATE FUNCTION public.claim_channel_scan_provider_request(
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
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM public.claim_channel_scan_provider_request(
    p_job_id, p_lease_id, p_channel_id, p_request_key, 'youtube'
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_firecrawl_transcript_recovery_target(
  p_job_id UUID,
  p_lease_id UUID,
  p_video_id UUID,
  p_youtube_video_id TEXT,
  p_status TEXT,
  p_language_code TEXT,
  p_transcript_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_final_status TEXT;
  v_transcript_id UUID;
  v_has_pending BOOLEAN;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('fetched', 'missing', 'skipped')
     OR (p_status = 'fetched' AND (p_language_code IS NULL OR p_transcript_text IS NULL OR pg_catalog.btrim(p_transcript_text) = ''))
     OR (p_status <> 'fetched' AND p_transcript_text IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_firecrawl_transcript_result';
  END IF;

  PERFORM 1
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.job_type = 'sync_channel_delta'
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scan_job_lease_lost'; END IF;

  PERFORM 1
  FROM public.channel_scan_firecrawl_transcript_targets AS t
  JOIN public.videos AS v ON v.id = t.video_id AND v.channel_id = t.channel_id
  WHERE t.job_id = p_job_id
    AND t.video_id = p_video_id
    AND t.youtube_video_id = p_youtube_video_id
    AND t.status = 'pending'
  FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'firecrawl_transcript_target_missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.firecrawl_transcript_recovery_settings AS s
    WHERE s.id = TRUE AND s.enabled = TRUE
  ) THEN
    UPDATE public.channel_scan_firecrawl_transcript_targets AS t
    SET status = 'disabled', updated_at = pg_catalog.clock_timestamp()
    WHERE t.job_id = p_job_id AND t.status = 'pending';
    RETURN pg_catalog.jsonb_build_object('status', 'disabled', 'hasPending', FALSE);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.video_transcripts AS t
    WHERE t.youtube_video_id = p_youtube_video_id
      AND t.transcript_status = 'fetched'
      AND pg_catalog.btrim(COALESCE(t.transcript_text, '')) <> ''
  ) THEN
    v_final_status := 'skipped';
  ELSIF p_status = 'fetched' THEN
    INSERT INTO public.video_transcripts (
      video_id, youtube_video_id, language_code, kind, is_asr,
      transcript_status, transcript_text, segments, source, fetched_at, error_details
    ) VALUES (
      p_video_id, p_youtube_video_id, p_language_code, 'unknown', NULL,
      'fetched', p_transcript_text, NULL, 'firecrawl-youtube-read', pg_catalog.clock_timestamp(), NULL
    )
    ON CONFLICT (youtube_video_id, language_code) DO UPDATE
    SET video_id = EXCLUDED.video_id,
        kind = 'unknown',
        is_asr = NULL,
        transcript_status = 'fetched',
        transcript_text = EXCLUDED.transcript_text,
        segments = NULL,
        source = 'firecrawl-youtube-read',
        fetched_at = pg_catalog.clock_timestamp(),
        error_details = NULL
    WHERE public.video_transcripts.transcript_status NOT IN ('fetched', 'legacy_missing')
    RETURNING id INTO v_transcript_id;

    v_final_status := CASE WHEN v_transcript_id IS NULL THEN 'skipped' ELSE 'fetched' END;
  ELSIF p_status = 'missing' THEN
    INSERT INTO public.video_transcripts (
      video_id, youtube_video_id, language_code, kind, is_asr,
      transcript_status, transcript_text, segments, source, fetched_at, error_details
    ) VALUES (
      p_video_id, p_youtube_video_id, 'unknown', 'unknown', NULL,
      'missing', NULL, NULL, 'firecrawl-youtube-read', NULL, 'firecrawl_transcript_unavailable'
    )
    ON CONFLICT (youtube_video_id, language_code) DO UPDATE
    SET video_id = EXCLUDED.video_id,
        kind = 'unknown',
        is_asr = NULL,
        transcript_status = 'missing',
        transcript_text = NULL,
        segments = NULL,
        source = 'firecrawl-youtube-read',
        fetched_at = NULL,
        error_details = 'firecrawl_transcript_unavailable'
    WHERE public.video_transcripts.transcript_status NOT IN ('fetched', 'legacy_missing')
    RETURNING id INTO v_transcript_id;

    v_final_status := CASE WHEN v_transcript_id IS NULL THEN 'skipped' ELSE 'missing' END;
  ELSE
    v_final_status := 'skipped';
  END IF;

  UPDATE public.channel_scan_firecrawl_transcript_targets AS t
  SET status = v_final_status,
      updated_at = pg_catalog.clock_timestamp()
  WHERE t.job_id = p_job_id AND t.video_id = p_video_id AND t.status = 'pending';

  SELECT EXISTS (
    SELECT 1 FROM public.channel_scan_firecrawl_transcript_targets AS t
    WHERE t.job_id = p_job_id AND t.status = 'pending'
  ) INTO v_has_pending;

  RETURN pg_catalog.jsonb_build_object('status', v_final_status, 'hasPending', v_has_pending);
END;
$$;

-- La canonicalizzazione resta atomica con l'import YouTube e con l'enqueue solo per nuovi video.
CREATE OR REPLACE FUNCTION public.commit_fenced_channel_import(
  p_job_id UUID,
  p_lease_id UUID,
  p_user_id UUID,
  p_requested_channel_id UUID,
  p_resolved_youtube_channel_id TEXT,
  p_resolved_channel_title TEXT,
  p_resolved_channel_handle TEXT,
  p_channel_snapshot JSONB,
  p_video_rows JSONB,
  p_sync_status TEXT,
  p_videos_found_count INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_channel_id UUID;
  v_canonical_channel_id UUID;
  v_active_references INTEGER;
  v_imported_count INTEGER := 0;
BEGIN
  PERFORM 1
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.status = 'running'
    AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scan_job_lease_lost' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1
  FROM public.user_channels AS uc
  WHERE uc.user_id = p_user_id AND uc.channel_id = p_requested_channel_id AND uc.is_active = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scan_channel_ownership_lost' USING ERRCODE = 'P0003'; END IF;

  SELECT c.id INTO v_effective_channel_id
  FROM public.channels AS c WHERE c.id = p_requested_channel_id FOR UPDATE;
  IF v_effective_channel_id IS NULL THEN RAISE EXCEPTION 'scan_channel_not_found' USING ERRCODE = 'P0002'; END IF;

  IF p_resolved_youtube_channel_id IS NOT NULL THEN
    SELECT c.id INTO v_canonical_channel_id
    FROM public.channels AS c
    WHERE c.youtube_channel_id = p_resolved_youtube_channel_id
    FOR UPDATE;

    IF v_canonical_channel_id IS NOT NULL AND v_canonical_channel_id <> v_effective_channel_id THEN
      INSERT INTO public.user_channels (user_id, channel_id, is_active, removed_at)
      VALUES (p_user_id, v_canonical_channel_id, TRUE, NULL)
      ON CONFLICT (user_id, channel_id) DO UPDATE
      SET is_active = TRUE, removed_at = NULL;

      UPDATE public.user_channels
      SET is_active = FALSE, removed_at = pg_catalog.clock_timestamp()
      WHERE user_id = p_user_id AND channel_id = v_effective_channel_id;

      INSERT INTO public.canonical_sync_state (channel_id)
      VALUES (v_canonical_channel_id)
      ON CONFLICT (channel_id) DO NOTHING;

      SELECT pg_catalog.count(*)::INTEGER INTO v_active_references
      FROM public.user_channels
      WHERE channel_id = v_effective_channel_id AND is_active = TRUE;
      IF v_active_references = 0 THEN
        UPDATE public.channels SET status = 'inactive' WHERE id = v_effective_channel_id;
      END IF;
      v_effective_channel_id := v_canonical_channel_id;
    ELSE
      UPDATE public.channels
      SET youtube_channel_id = p_resolved_youtube_channel_id,
          title = COALESCE(p_resolved_channel_title, title),
          handle = COALESCE(p_resolved_channel_handle, handle)
      WHERE id = v_effective_channel_id;
    END IF;
  END IF;

  UPDATE public.channels
  SET title = COALESCE(p_channel_snapshot->>'title', title),
      description = COALESCE(p_channel_snapshot->>'description', description),
      thumbnail_url = COALESCE(p_channel_snapshot->>'thumbnail_url', thumbnail_url),
      subscriber_count = COALESCE((p_channel_snapshot->>'subscriber_count')::BIGINT, subscriber_count),
      video_count = COALESCE((p_channel_snapshot->>'video_count')::INTEGER, video_count),
      custom_url = COALESCE(p_channel_snapshot->>'custom_url', custom_url),
      youtube_metadata = COALESCE(p_channel_snapshot->'raw', youtube_metadata)
  WHERE id = v_effective_channel_id;

  WITH incoming AS MATERIALIZED (
    SELECT row_data.*
    FROM pg_catalog.jsonb_to_recordset(COALESCE(p_video_rows, '[]'::JSONB)) AS row_data(
      youtube_video_id TEXT,
      title TEXT,
      description TEXT,
      thumbnail_url TEXT,
      published_at TIMESTAMPTZ,
      duration_seconds INTEGER,
      video_url TEXT,
      video_type TEXT,
      availability_status TEXT,
      youtube_metadata JSONB
    )
  ), new_video_candidates AS MATERIALIZED (
    SELECT incoming.youtube_video_id
    FROM incoming
    WHERE NOT EXISTS (
      SELECT 1 FROM public.videos AS existing
      WHERE existing.youtube_video_id = incoming.youtube_video_id
    )
  ), upserted AS (
    INSERT INTO public.videos (
      channel_id, youtube_video_id, title, description, thumbnail_url,
      published_at, duration_seconds, video_url, video_type, availability_status, youtube_metadata
    )
    SELECT v_effective_channel_id, incoming.youtube_video_id, incoming.title, incoming.description,
           incoming.thumbnail_url, incoming.published_at, incoming.duration_seconds, incoming.video_url,
           incoming.video_type, incoming.availability_status, incoming.youtube_metadata
    FROM incoming
    ON CONFLICT (youtube_video_id) DO UPDATE SET
      channel_id = EXCLUDED.channel_id,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      thumbnail_url = EXCLUDED.thumbnail_url,
      published_at = EXCLUDED.published_at,
      duration_seconds = EXCLUDED.duration_seconds,
      video_url = EXCLUDED.video_url,
      video_type = EXCLUDED.video_type,
      availability_status = EXCLUDED.availability_status,
      youtube_metadata = EXCLUDED.youtube_metadata
    RETURNING id, youtube_video_id
  ), queued_firecrawl AS (
    INSERT INTO public.channel_scan_firecrawl_transcript_targets (
      job_id, channel_id, video_id, youtube_video_id
    )
    SELECT p_job_id, v_effective_channel_id, upserted.id, upserted.youtube_video_id
    FROM upserted
    JOIN new_video_candidates USING (youtube_video_id)
    WHERE EXISTS (
      SELECT 1 FROM public.firecrawl_transcript_recovery_settings AS s
      WHERE s.id = TRUE AND s.enabled = TRUE
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.video_transcripts AS transcript
        WHERE transcript.youtube_video_id = upserted.youtube_video_id
          AND transcript.transcript_status IN ('fetched', 'legacy_missing')
      )
    ON CONFLICT (video_id) DO NOTHING
    RETURNING video_id
  )
  SELECT pg_catalog.count(*)::INTEGER INTO v_imported_count FROM upserted;

  -- Non creare placeholder pending per la pipeline legacy, anche con il gate Firecrawl chiuso.

  INSERT INTO public.canonical_sync_state (channel_id, last_sync_at, last_sync_status, videos_found_count)
  VALUES (v_effective_channel_id, pg_catalog.clock_timestamp(), p_sync_status, p_videos_found_count)
  ON CONFLICT (channel_id) DO UPDATE SET
    last_sync_at = EXCLUDED.last_sync_at,
    last_sync_status = EXCLUDED.last_sync_status,
    videos_found_count = EXCLUDED.videos_found_count;

  UPDATE public.user_provider_credentials
  SET is_valid = TRUE, last_used_at = pg_catalog.clock_timestamp(), last_error = NULL
  WHERE user_id = p_user_id AND provider = 'youtube';

  RETURN pg_catalog.jsonb_build_object(
    'channelId', v_effective_channel_id,
    'importedCount', v_imported_count,
    'scannedCount', pg_catalog.jsonb_array_length(COALESCE(p_video_rows, '[]'::JSONB))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_channel_scan_provider_request(UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_channel_scan_provider_request(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_firecrawl_transcript_recovery_target(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_channel_scan_provider_request(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_channel_scan_provider_request(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_firecrawl_transcript_recovery_target(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
