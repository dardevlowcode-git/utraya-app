-- Commento didattico:
-- Scopo: l'import atomico del canale smette di accodare target di recupero transcript Firecrawl.
-- Flusso: ridefinisce solo commit_fenced_channel_import (firma, SECURITY DEFINER, search_path e ACL invariati)
-- togliendo l'INSERT in channel_scan_firecrawl_transcript_targets; il resto dell'import resta identico.
-- Nessuna tabella o dato viene eliminato: gate, target, video_transcripts, transcript_fetch_diagnostics e
-- cron_settings restano intatti ma inutilizzati. complete_firecrawl_transcript_recovery_target e il ramo
-- 'firecrawl' di claim_channel_scan_provider_request restano nel database, inutilizzati dal codice APP.

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
  )
  SELECT pg_catalog.count(*)::INTEGER INTO v_imported_count FROM upserted;

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

NOTIFY pgrst, 'reload schema';
