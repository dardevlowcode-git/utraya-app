-- Commento didattico:
-- Scopo del file: trascrizione automatica dei video nuovi fino a 90 minuti (ADR-019) con chiavi Gemini dei follower
-- in rotazione per canale e provider (ADR-018). Schema additivo: cursore round-robin, assegnazione chiave per job,
-- eleggibilità, accodamento atomico con l'import del canale.
-- Flusso: l'import atomico del canale calcola i video davvero nuovi PRIMA dell'upsert e, nella stessa transazione,
-- crea trascrizione, parti e job `transcribe_video` (senza utente richiedente). Il worker chiede una chiave con
-- `claim_transcription_job_credential`; se una chiave esaurisce i tentativi su una parte la rilascia con
-- `release_transcription_job_credential` e il job passa alla chiave successiva.

-- ============================================================
-- Cursore round-robin per (canale, provider) e chiavi assegnate a ogni job (stesso schema della rotazione YouTube)
-- ============================================================
CREATE TABLE public.transcription_key_rotation_cursors (
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'gemini'),
  last_credential_id UUID REFERENCES public.user_provider_credentials(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, provider)
);

CREATE TABLE public.transcription_job_credentials (
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL REFERENCES public.user_provider_credentials(id) ON DELETE CASCADE,
  key_version UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'exhausted', 'ineligible')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, credential_id, key_version)
);

CREATE UNIQUE INDEX idx_transcription_job_one_active_credential
  ON public.transcription_job_credentials (job_id)
  WHERE status = 'active';

-- Ricerca dei job automatici pending di un canale (post-scan, catena, recupero giornaliero).
CREATE INDEX idx_jobs_transcription_channel_pending
  ON public.jobs ((payload->>'channelId'), created_at)
  WHERE job_type = 'transcribe_video' AND status = 'pending';

ALTER TABLE public.transcription_key_rotation_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcription_job_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.transcription_key_rotation_cursors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.transcription_job_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transcription_key_rotation_cursors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transcription_job_credentials TO service_role;

-- ============================================================
-- Eleggibilità: solo chiavi Gemini valide di utenti che seguono attivamente il canale
-- ============================================================
CREATE FUNCTION public.transcription_eligible_credentials(p_channel_id UUID)
RETURNS TABLE(credential_id UUID, user_id UUID, key_version UUID, retry_limit INTEGER, added_at TIMESTAMPTZ, ord BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.id, c.user_id, l.key_version, l.retry_limit, uc.added_at,
         pg_catalog.row_number() OVER (ORDER BY uc.added_at, uc.user_id, c.id)
  FROM public.user_channels AS uc
  JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = 'gemini'
  JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
  WHERE uc.channel_id = p_channel_id
    AND uc.is_active = TRUE
    AND c.is_configured = TRUE
    AND c.encrypted_key IS NOT NULL
    AND c.is_valid IS DISTINCT FROM FALSE
$$;

-- Vero se il canale ha almeno una chiave eleggibile (filtro economico prima di reclamare un job automatico).
CREATE FUNCTION public.has_eligible_transcription_credential(p_channel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.transcription_eligible_credentials(p_channel_id))
$$;

-- ============================================================
-- Assegnazione della chiave a un job automatico (round-robin per canale, fissa per i retry)
-- status: assigned | waiting (nessuna chiave eleggibile) | exhausted (eleggibili tutte già usate) | lease_lost
-- ============================================================
CREATE FUNCTION public.claim_transcription_job_credential(
  p_job_id UUID,
  p_lease_id UUID,
  p_channel_id UUID
)
RETURNS TABLE(status TEXT, credential_id UUID, user_id UUID, key_version UUID, retry_limit INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_cursor_credential UUID;
  v_anchor BIGINT;
  v_credential_id UUID;
  v_user_id UUID;
  v_key_version UUID;
  v_retry_limit INTEGER;
BEGIN
  PERFORM 1 FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.job_type = 'transcribe_video'
    AND j.payload->>'channelId' = p_channel_id::TEXT
    AND j.status = 'running' AND j.lease_id = p_lease_id
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  FOR SHARE;
  IF NOT FOUND THEN
    status := 'lease_lost'; credential_id := NULL; user_id := NULL; key_version := NULL; retry_limit := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- La chiave già assegnata al job resta la stessa finché è eleggibile (retry sulla stessa chiave).
  SELECT jk.credential_id, e.user_id, jk.key_version, e.retry_limit
  INTO v_credential_id, v_user_id, v_key_version, v_retry_limit
  FROM public.transcription_job_credentials AS jk
  JOIN public.transcription_eligible_credentials(p_channel_id) AS e
    ON e.credential_id = jk.credential_id AND e.key_version = jk.key_version
  WHERE jk.job_id = p_job_id AND jk.status = 'active'
  LIMIT 1;

  IF v_credential_id IS NOT NULL THEN
    status := 'assigned'; credential_id := v_credential_id; user_id := v_user_id;
    key_version := v_key_version; retry_limit := v_retry_limit;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Chiave rimossa, invalidata, sostituita o follower che ha smesso di seguire: esclusa da qui in avanti.
  UPDATE public.transcription_job_credentials AS jk
  SET status = 'ineligible', updated_at = pg_catalog.clock_timestamp()
  WHERE jk.job_id = p_job_id AND jk.status = 'active';

  -- Il cursore serializza le assegnazioni dello stesso canale.
  INSERT INTO public.transcription_key_rotation_cursors (channel_id, provider)
  VALUES (p_channel_id, 'gemini')
  ON CONFLICT (channel_id, provider) DO NOTHING;

  SELECT cur.last_credential_id INTO v_cursor_credential
  FROM public.transcription_key_rotation_cursors AS cur
  WHERE cur.channel_id = p_channel_id AND cur.provider = 'gemini'
  FOR UPDATE;

  -- Posizione del cursore nella lista ordinata degli eleggibili (0 se il cursore non segue più il canale).
  SELECT pg_catalog.count(*) INTO v_anchor
  FROM public.transcription_eligible_credentials(p_channel_id) AS e
  JOIN public.user_provider_credentials AS cc ON cc.id = v_cursor_credential
  JOIN public.user_channels AS cu ON cu.user_id = cc.user_id AND cu.channel_id = p_channel_id AND cu.is_active = TRUE
  WHERE (e.added_at, e.user_id, e.credential_id) <= (cu.added_at, cu.user_id, cc.id);

  SELECT e.credential_id, e.user_id, e.key_version, e.retry_limit
  INTO v_credential_id, v_user_id, v_key_version, v_retry_limit
  FROM public.transcription_eligible_credentials(p_channel_id) AS e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.transcription_job_credentials AS used
    WHERE used.job_id = p_job_id AND used.credential_id = e.credential_id AND used.key_version = e.key_version
  )
  ORDER BY CASE WHEN e.ord > v_anchor THEN 0 ELSE 1 END, e.ord
  LIMIT 1;

  IF v_credential_id IS NULL THEN
    status := CASE WHEN public.has_eligible_transcription_credential(p_channel_id) THEN 'exhausted' ELSE 'waiting' END;
    credential_id := NULL; user_id := NULL; key_version := NULL; retry_limit := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.transcription_job_credentials (job_id, credential_id, key_version, status)
  VALUES (p_job_id, v_credential_id, v_key_version, 'active');

  UPDATE public.transcription_key_rotation_cursors AS cur
  SET last_credential_id = v_credential_id, updated_at = pg_catalog.clock_timestamp()
  WHERE cur.channel_id = p_channel_id AND cur.provider = 'gemini';

  status := 'assigned'; credential_id := v_credential_id; user_id := v_user_id;
  key_version := v_key_version; retry_limit := v_retry_limit;
  RETURN NEXT;
END;
$$;

-- Rilascia la chiave attiva del job (esaurita su una parte o non utilizzabile): le parti ancora pending ripartono
-- da zero tentativi sulla chiave successiva; la chiave rilasciata non torna più nello stesso job.
CREATE FUNCTION public.release_transcription_job_credential(
  p_job_id UUID,
  p_lease_id UUID,
  p_credential_id UUID,
  p_key_version UUID,
  p_status TEXT,
  p_transcription_id UUID,
  p_part_position INTEGER,
  p_last_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('exhausted', 'ineligible') THEN
    RAISE EXCEPTION 'invalid_transcription_credential_status';
  END IF;

  PERFORM 1 FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.job_type = 'transcribe_video'
    AND j.status = 'running' AND j.lease_id = p_lease_id AND j.lease_expires_at > v_now
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.transcription_job_credentials AS jk
  SET status = p_status, updated_at = v_now
  WHERE jk.job_id = p_job_id AND jk.credential_id = p_credential_id
    AND jk.key_version = p_key_version AND jk.status = 'active';

  UPDATE public.transcription_parts AS tp
  SET attempts = 0,
      last_error = CASE WHEN tp.position = p_part_position THEN pg_catalog.left(p_last_error, 200) ELSE tp.last_error END,
      updated_at = v_now
  WHERE tp.transcription_id = p_transcription_id AND tp.status = 'pending';
  RETURN TRUE;
END;
$$;

-- ============================================================
-- Accodamento automatico: trascrizione + parti + job, idempotente, solo per video eleggibili
-- ============================================================
CREATE FUNCTION public.enqueue_auto_transcriptions(p_channel_id UUID, p_youtube_video_ids TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max_seconds CONSTANT INTEGER := 5400;
  v_chunk CONSTANT INTEGER := 120;
  v_model TEXT;
  v_thinking TEXT;
  v_video RECORD;
  v_transcription_id UUID;
  v_rows INTEGER;
  v_queued INTEGER := 0;
BEGIN
  SELECT p.model, p.thinking_level INTO v_model, v_thinking
  FROM public.transcription_profile AS p WHERE p.id = TRUE;
  v_model := COALESCE(v_model, 'gemini-3.1-flash-lite');
  v_thinking := COALESCE(v_thinking, 'minimal');

  FOR v_video IN
    SELECT v.id, v.duration_seconds
    FROM public.videos AS v
    WHERE v.channel_id = p_channel_id
      AND v.youtube_video_id = ANY (COALESCE(p_youtube_video_ids, ARRAY[]::TEXT[]))
      AND v.availability_status = 'available'
      AND v.duration_seconds BETWEEN 1 AND v_max_seconds
      AND NOT EXISTS (SELECT 1 FROM public.transcriptions AS t WHERE t.video_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS j
        WHERE j.job_type = 'transcribe_video' AND j.status IN ('pending', 'running')
          AND j.payload->>'videoId' = v.id::TEXT
      )
    ORDER BY v.published_at, v.id
  LOOP
    v_transcription_id := NULL;
    INSERT INTO public.transcriptions (video_id, status, model, thinking_level, requested_by_user_id, chunk_seconds)
    VALUES (v_video.id, 'pending', v_model, v_thinking, NULL, v_chunk)
    ON CONFLICT (video_id) DO NOTHING
    RETURNING id INTO v_transcription_id;
    IF v_transcription_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.transcription_parts (transcription_id, position, start_seconds, end_seconds)
    SELECT v_transcription_id, g.n, g.n * v_chunk, LEAST((g.n + 1) * v_chunk, v_video.duration_seconds)
    FROM pg_catalog.generate_series(0, (v_video.duration_seconds - 1) / v_chunk) AS g(n);

    INSERT INTO public.jobs (job_type, status, priority, payload, created_by_user_id)
    VALUES (
      'transcribe_video', 'pending', 4,
      pg_catalog.jsonb_build_object(
        'videoId', v_video.id,
        'transcriptionId', v_transcription_id,
        'requestedByUserId', NULL,
        'credentialOwnerUserId', NULL,
        'channelId', p_channel_id
      ),
      NULL
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_queued := v_queued + v_rows;
  END LOOP;
  RETURN v_queued;
END;
$$;

REVOKE ALL ON FUNCTION public.transcription_eligible_credentials(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_eligible_transcription_credential(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_transcription_job_credential(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_transcription_job_credential(UUID, UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_auto_transcriptions(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.transcription_eligible_credentials(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_eligible_transcription_credential(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_transcription_job_credential(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_transcription_job_credential(UUID, UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_auto_transcriptions(UUID, TEXT[]) TO service_role;

-- ============================================================
-- Import atomico del canale: identico alla versione precedente, più accodamento dei soli video nuovi
-- (firma, SECURITY DEFINER, search_path e ACL invariati)
-- ============================================================
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
  v_new_video_ids TEXT[];
  v_transcriptions_queued INTEGER := 0;
  v_first_scan BOOLEAN;
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

  -- Video davvero nuovi: calcolati prima dell'upsert, dopo non sarebbero più distinguibili da quelli già presenti.
  -- Prima scansione del canale (nessuna sincronizzazione precedente): i video sono storici e restano su richiesta.
  -- Va valutata qui, prima che questa stessa transazione aggiorni canonical_sync_state.
  v_first_scan := NOT EXISTS (
    SELECT 1 FROM public.canonical_sync_state AS s
    WHERE s.channel_id = v_effective_channel_id AND s.last_sync_at IS NOT NULL
  );

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT incoming.youtube_video_id), ARRAY[]::TEXT[])
  INTO v_new_video_ids
  FROM pg_catalog.jsonb_to_recordset(COALESCE(p_video_rows, '[]'::JSONB)) AS incoming(youtube_video_id TEXT)
  WHERE NOT v_first_scan
    AND incoming.youtube_video_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.videos AS existing WHERE existing.youtube_video_id = incoming.youtube_video_id);

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

  -- Stessa transazione dell'import: nessun video nuovo può restare senza lavoro dopo il commit.
  v_transcriptions_queued := public.enqueue_auto_transcriptions(v_effective_channel_id, v_new_video_ids);

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
    'scannedCount', pg_catalog.jsonb_array_length(COALESCE(p_video_rows, '[]'::JSONB)),
    'transcriptionsQueued', v_transcriptions_queued
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
