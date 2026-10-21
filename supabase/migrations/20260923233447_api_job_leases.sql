-- Commento didattico:
-- Scopo del file: aggiunge fencing e scadenza ai job API asincroni per impedire doppie esecuzioni dopo un timeout.
-- Flusso: il worker acquisisce lease_id atomico; recovery può rimettere pending solo lease scadute.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS lease_id UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

UPDATE public.jobs
SET status = 'pending', started_at = NULL, error_message = 'requeued_legacy_without_lease'
WHERE job_type = 'sync_channel_delta'
  AND status = 'running'
  AND lease_id IS NULL
  AND lease_expires_at IS NULL
  AND started_at < NOW() - INTERVAL '10 minutes';

CREATE INDEX IF NOT EXISTS idx_jobs_scan_lease_recovery
  ON public.jobs (job_type, status, lease_expires_at, created_at)
  WHERE job_type = 'sync_channel_delta'
    AND status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS public.api_verifier_oidc_nonces (
  jti TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.api_verifier_oidc_nonces ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_api_verifier_oidc_nonces_expires
  ON public.api_verifier_oidc_nonces (expires_at);

DROP POLICY IF EXISTS "Users: update own" ON public.users;

CREATE POLICY "Users: update own" ON public.users
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()) AND status = 'active')
  WITH CHECK (id = (select auth.uid()) AND status = 'active');

-- Esegue il commit canonico di uno scan solo mentre il worker possiede ancora
-- la lease. Il lock FOR UPDATE serializza il commit con la recovery: un worker
-- scaduto non puo` scrivere dopo che un altro worker ha reclamato il job.
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
SET search_path = public
AS $$
DECLARE
  effective_channel_id UUID;
  canonical_channel_id UUID;
  active_references INTEGER;
  imported_count INTEGER := 0;
BEGIN
  PERFORM 1
  FROM public.jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_id = p_lease_id
    AND lease_expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_job_lease_lost' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.user_channels
  WHERE user_id = p_user_id
    AND channel_id = p_requested_channel_id
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scan_channel_ownership_lost' USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO effective_channel_id
  FROM public.channels
  WHERE id = p_requested_channel_id
  FOR UPDATE;

  IF effective_channel_id IS NULL THEN
    RAISE EXCEPTION 'scan_channel_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_resolved_youtube_channel_id IS NOT NULL THEN
    SELECT id INTO canonical_channel_id
    FROM public.channels
    WHERE youtube_channel_id = p_resolved_youtube_channel_id
    FOR UPDATE;

    IF canonical_channel_id IS NOT NULL AND canonical_channel_id <> effective_channel_id THEN
      INSERT INTO public.user_channels (user_id, channel_id, is_active, removed_at)
      VALUES (p_user_id, canonical_channel_id, TRUE, NULL)
      ON CONFLICT (user_id, channel_id) DO UPDATE
      SET is_active = TRUE, removed_at = NULL;

      UPDATE public.user_channels
      SET is_active = FALSE, removed_at = NOW()
      WHERE user_id = p_user_id AND channel_id = effective_channel_id;

      INSERT INTO public.canonical_sync_state (channel_id)
      VALUES (canonical_channel_id)
      ON CONFLICT (channel_id) DO NOTHING;

      SELECT count(*) INTO active_references
      FROM public.user_channels
      WHERE channel_id = effective_channel_id AND is_active = TRUE;

      IF active_references = 0 THEN
        UPDATE public.channels SET status = 'inactive' WHERE id = effective_channel_id;
      END IF;

      effective_channel_id := canonical_channel_id;
    ELSE
      UPDATE public.channels
      SET youtube_channel_id = p_resolved_youtube_channel_id,
          title = COALESCE(p_resolved_channel_title, title),
          handle = COALESCE(p_resolved_channel_handle, handle)
      WHERE id = effective_channel_id;
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
  WHERE id = effective_channel_id;

  INSERT INTO public.videos (
    channel_id, youtube_video_id, title, description, thumbnail_url,
    published_at, duration_seconds, video_url, video_type,
    availability_status, youtube_metadata
  )
  SELECT
    effective_channel_id, video_row.youtube_video_id, video_row.title, video_row.description,
    video_row.thumbnail_url, video_row.published_at, video_row.duration_seconds, video_row.video_url,
    video_row.video_type, video_row.availability_status, video_row.youtube_metadata
  FROM jsonb_to_recordset(COALESCE(p_video_rows, '[]'::JSONB)) AS video_row(
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
    youtube_metadata = EXCLUDED.youtube_metadata;

  SELECT count(*) INTO imported_count
  FROM public.videos v
  WHERE v.youtube_video_id IN (
    SELECT video_row.youtube_video_id
    FROM jsonb_to_recordset(COALESCE(p_video_rows, '[]'::JSONB)) AS video_row(youtube_video_id TEXT)
  );

  -- L'arricchimento transcript resta fail-open, come nel service storico:
  -- un errore di schema/cache non deve annullare l'import canonico.
  BEGIN
    INSERT INTO public.video_transcripts (
      video_id, youtube_video_id, language_code, kind, transcript_status, source
    )
    SELECT v.id, v.youtube_video_id, 'unknown', 'unknown', 'pending', 'youtubei-timedtext'
    FROM public.videos v
    WHERE v.youtube_video_id IN (
      SELECT video_row.youtube_video_id
      FROM jsonb_to_recordset(COALESCE(p_video_rows, '[]'::JSONB)) AS video_row(youtube_video_id TEXT)
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.video_transcripts t
        WHERE t.youtube_video_id = v.youtube_video_id
          AND t.transcript_status IN ('fetched', 'legacy_missing')
      )
    ON CONFLICT (youtube_video_id, language_code) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.canonical_sync_state (channel_id, last_sync_at, last_sync_status, videos_found_count)
  VALUES (effective_channel_id, NOW(), p_sync_status, p_videos_found_count)
  ON CONFLICT (channel_id) DO UPDATE SET
    last_sync_at = EXCLUDED.last_sync_at,
    last_sync_status = EXCLUDED.last_sync_status,
    videos_found_count = EXCLUDED.videos_found_count;

  UPDATE public.user_provider_credentials
  SET is_valid = TRUE, last_used_at = NOW(), last_error = NULL
  WHERE user_id = p_user_id AND provider = 'youtube';

  RETURN jsonb_build_object(
    'channelId', effective_channel_id,
    'importedCount', imported_count,
    'scannedCount', jsonb_array_length(COALESCE(p_video_rows, '[]'::JSONB))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.commit_fenced_channel_import(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_fenced_channel_import(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_fenced_channel_import(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_fenced_channel_import(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER) TO service_role;
