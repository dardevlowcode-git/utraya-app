-- Commento didattico:
-- Scopo del file: corregge il rilancio admin delle trascrizioni (P5). La chiave del richiedente originale
-- viene usata solo se il richiedente è ancora idoneo: utente attivo, TOS correnti accettati e canale
-- ancora seguito attivamente. Altrimenti si passa alla rotazione fra le chiavi eleggibili del canale;
-- se non ce ne sono, il job resta in attesa come per i lavori automatici (ADR-018).
-- Flusso: `CREATE OR REPLACE` della sola funzione; firma, modalità (`SECURITY INVOKER`), `search_path`,
-- ACL e audit restano identici. Nessun'altra funzione del ticket 06 cambia.

CREATE OR REPLACE FUNCTION public.relaunch_missing_transcription_parts(
  p_transcription_id UUID,
  p_part_position INTEGER,
  p_admin_username TEXT
)
RETURNS TABLE(status TEXT, job_id UUID, parts_reset INTEGER, credential_mode TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_t public.transcriptions%ROWTYPE;
  v_channel_id UUID;
  v_job public.jobs%ROWTYPE;
  v_job_id UUID;
  v_reset INTEGER;
  v_owner UUID;
  v_mode TEXT;
BEGIN
  IF p_admin_username IS NULL OR pg_catalog.char_length(p_admin_username) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_admin_username';
  END IF;

  SELECT t.* INTO v_t FROM public.transcriptions AS t WHERE t.id = p_transcription_id FOR UPDATE;
  IF NOT FOUND THEN
    status := 'not_found'; job_id := NULL; parts_reset := 0; credential_mode := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Un job con lease viva sta lavorando: non si toccano parti né chiavi sotto i suoi piedi.
  SELECT j.* INTO v_job
  FROM public.jobs AS j
  WHERE j.job_type = 'transcribe_video'
    AND j.payload->>'videoId' = v_t.video_id::TEXT
    AND j.status IN ('pending', 'running')
  FOR UPDATE;
  IF FOUND AND v_job.status = 'running' AND v_job.lease_expires_at > v_now THEN
    status := 'busy'; job_id := v_job.id; parts_reset := 0; credential_mode := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.transcription_parts AS tp
    WHERE tp.transcription_id = v_t.id AND tp.status = 'missing'
      AND (p_part_position IS NULL OR tp.position = p_part_position)
  ) THEN
    status := 'no_missing'; job_id := NULL; parts_reset := 0; credential_mode := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Solo le parti mancanti tornano pending; le chiavi già esaurite per quelle parti si svuotano.
  WITH reset AS (
    UPDATE public.transcription_parts AS tp
    SET status = 'pending', attempts = 0, last_error = NULL, updated_at = v_now
    WHERE tp.transcription_id = v_t.id AND tp.status = 'missing'
      AND (p_part_position IS NULL OR tp.position = p_part_position)
    RETURNING tp.position
  ), cleared AS (
    DELETE FROM public.transcription_part_exhausted_keys AS x
    USING reset
    WHERE x.transcription_id = v_t.id AND x.part_position = reset.position
    RETURNING 1
  )
  SELECT pg_catalog.count(*) INTO v_reset FROM reset;

  -- Chiave: il richiedente originale solo se presente nell'unica fonte canonica di eleggibilità;
  -- altrimenti rotazione per canale.
  SELECT v.channel_id INTO v_channel_id FROM public.videos AS v WHERE v.id = v_t.video_id;
  IF v_t.requested_by_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.transcription_eligible_credentials(v_channel_id) AS e
       WHERE e.user_id = v_t.requested_by_user_id
     ) THEN
    v_owner := v_t.requested_by_user_id;
    v_mode := 'requester';
  ELSE
    v_owner := NULL;
    v_mode := 'channel_rotation';
  END IF;

  IF v_job.id IS NOT NULL THEN
    -- Job fermo (pending o lease scaduta): lo si riattiva con la chiave scelta e senza esclusioni di chiavi residue.
    UPDATE public.jobs AS j
    SET payload = j.payload || pg_catalog.jsonb_build_object(
          'requestedByUserId', v_owner, 'credentialOwnerUserId', v_owner, 'channelId', v_channel_id)
    WHERE j.id = v_job.id;
    DELETE FROM public.transcription_job_credentials AS jk WHERE jk.job_id = v_job.id AND jk.status <> 'active';
    v_job_id := v_job.id;
  ELSE
    INSERT INTO public.jobs (job_type, status, priority, payload, created_by_user_id)
    VALUES (
      'transcribe_video', 'pending', 3,
      pg_catalog.jsonb_build_object(
        'videoId', v_t.video_id,
        'transcriptionId', v_t.id,
        'requestedByUserId', v_owner,
        'credentialOwnerUserId', v_owner,
        'channelId', v_channel_id
      ),
      NULL
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_job_id;
    IF v_job_id IS NULL THEN
      -- Un altro processo ha creato il job fra il controllo e l'inserimento: si usa quello.
      SELECT j.id INTO v_job_id FROM public.jobs AS j
      WHERE j.job_type = 'transcribe_video' AND j.payload->>'videoId' = v_t.video_id::TEXT
        AND j.status IN ('pending', 'running')
      LIMIT 1;
    END IF;
  END IF;

  UPDATE public.transcriptions AS t
  SET status = 'running',
      missing_part_count = (SELECT pg_catalog.count(*) FROM public.transcription_parts AS tp
                            WHERE tp.transcription_id = t.id AND tp.status = 'missing'),
      completed_at = NULL,
      updated_at = v_now
  WHERE t.id = v_t.id;

  INSERT INTO public.transcription_relaunch_audit
    (admin_username, transcription_id, video_id, part_position, parts_reset, job_id, credential_mode)
  VALUES (p_admin_username, v_t.id, v_t.video_id, p_part_position, v_reset, v_job_id, v_mode);

  status := 'relaunched'; job_id := v_job_id; parts_reset := v_reset; credential_mode := v_mode;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.relaunch_missing_transcription_parts(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relaunch_missing_transcription_parts(UUID, INTEGER, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
