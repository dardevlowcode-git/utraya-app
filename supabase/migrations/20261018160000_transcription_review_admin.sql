-- Commento didattico:
-- Scopo del file: revisione amministrativa delle trascrizioni da rivedere (ticket 06): rilancio atomico delle sole parti
-- mancanti con audit senza segreti e conteggi per stato in una finestra di giorni.
-- Flusso: `relaunch_missing_transcription_parts` (solo service_role) blocca la trascrizione, riporta le parti `missing`
-- a `pending` con tentativi ed errore azzerati, svuota le chiavi esaurite di quelle parti, sceglie la chiave (richiedente
-- originale se ancora valida, altrimenti rotazione per canale), crea o riattiva l'unico job `transcribe_video` del video
-- e scrive l'audit nella stessa transazione. Le parti `done` e le loro frasi non vengono mai toccate.

CREATE TABLE public.transcription_relaunch_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_username TEXT NOT NULL CHECK (char_length(admin_username) BETWEEN 1 AND 200),
  transcription_id UUID REFERENCES public.transcriptions(id) ON DELETE SET NULL,
  video_id UUID NOT NULL,
  -- NULL = tutte le parti mancanti della trascrizione, altrimenti la singola parte rilanciata.
  part_position INTEGER CHECK (part_position IS NULL OR part_position >= 0),
  parts_reset INTEGER NOT NULL CHECK (parts_reset > 0),
  job_id UUID,
  credential_mode TEXT NOT NULL CHECK (credential_mode IN ('requester', 'channel_rotation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX transcription_relaunch_audit_created_idx
  ON public.transcription_relaunch_audit (created_at DESC);

ALTER TABLE public.transcription_relaunch_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transcription_relaunch_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.transcription_relaunch_audit TO service_role;

-- Rilancia le sole parti mancanti (tutte, oppure quella in p_part_position).
-- status: relaunched | not_found | no_missing | busy (job con lease viva: nessuna modifica)
CREATE FUNCTION public.relaunch_missing_transcription_parts(
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

  -- Chiave: il richiedente originale se la sua chiave Gemini è ancora valida, altrimenti rotazione per canale.
  SELECT v.channel_id INTO v_channel_id FROM public.videos AS v WHERE v.id = v_t.video_id;
  IF v_t.requested_by_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_provider_credentials AS c
    WHERE c.user_id = v_t.requested_by_user_id AND c.provider = 'gemini'
      AND c.is_configured = TRUE AND c.encrypted_key IS NOT NULL AND c.is_valid IS DISTINCT FROM FALSE
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

-- Conteggi per stato (e frasi dubbie) delle trascrizioni con data di riferimento negli ultimi p_days giorni.
-- Data di riferimento = completed_at, o updated_at per quelle non ancora concluse.
CREATE FUNCTION public.transcription_review_stats(p_days INTEGER)
RETURNS TABLE(status TEXT, total BIGINT, doubtful_phrases BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT t.status, pg_catalog.count(*)::BIGINT, COALESCE(pg_catalog.sum(t.doubtful_phrase_count), 0)::BIGINT
  FROM public.transcriptions AS t
  WHERE COALESCE(t.completed_at, t.updated_at) >= pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => p_days)
  GROUP BY t.status
$$;

REVOKE ALL ON FUNCTION public.relaunch_missing_transcription_parts(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transcription_review_stats(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relaunch_missing_transcription_parts(UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.transcription_review_stats(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
