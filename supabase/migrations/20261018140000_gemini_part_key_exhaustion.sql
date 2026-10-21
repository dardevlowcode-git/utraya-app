-- Commento didattico:
-- Scopo del file: l'esaurimento dei tentativi è per PARTE e non per job. Una parte che esaurisce `1 + retry_limit`
-- tentativi su una chiave passa alla successiva chiave eleggibile non ancora provata per quella parte; senza altre
-- chiavi diventa `missing`. Le altre parti proseguono con la chiave del job.
-- Flusso: `record_transcription_part_key_exhausted` registra la chiave esaurita per la parte e azzera i suoi tentativi;
-- `claim_transcription_part_credential` sceglie la chiave per la parte (prima quella del job, poi le altre eleggibili),
-- senza mai tornare su una chiave già esaurita per quella parte. Migration additiva: le precedenti non cambiano.

CREATE TABLE public.transcription_part_exhausted_keys (
  transcription_id UUID NOT NULL,
  part_position INTEGER NOT NULL,
  credential_id UUID NOT NULL REFERENCES public.user_provider_credentials(id) ON DELETE CASCADE,
  key_version UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (transcription_id, part_position, credential_id, key_version),
  FOREIGN KEY (transcription_id, part_position)
    REFERENCES public.transcription_parts (transcription_id, position) ON DELETE CASCADE
);

ALTER TABLE public.transcription_part_exhausted_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transcription_part_exhausted_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transcription_part_exhausted_keys TO service_role;

-- Registra la chiave esaurita per la parte e riparte da zero tentativi sulla chiave successiva.
CREATE FUNCTION public.record_transcription_part_key_exhausted(
  p_job_id UUID,
  p_lease_id UUID,
  p_transcription_id UUID,
  p_part_position INTEGER,
  p_credential_id UUID,
  p_key_version UUID,
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
  PERFORM 1 FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.job_type = 'transcribe_video'
    AND j.status = 'running' AND j.lease_id = p_lease_id AND j.lease_expires_at > v_now
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.transcription_part_exhausted_keys (transcription_id, part_position, credential_id, key_version)
  VALUES (p_transcription_id, p_part_position, p_credential_id, p_key_version)
  ON CONFLICT DO NOTHING;

  UPDATE public.transcription_parts AS tp
  SET attempts = 0, last_error = pg_catalog.left(p_last_error, 200), updated_at = v_now
  WHERE tp.transcription_id = p_transcription_id AND tp.position = p_part_position AND tp.status = 'pending';
  RETURN TRUE;
END;
$$;

-- Chiave per una parte di un job automatico: prima quella attiva del job, poi le altre eleggibili del canale
-- (in ordine circolare dopo di essa), escluse quelle già esaurite per la parte. Non muove il cursore del canale.
-- status: assigned | none (nessuna chiave utilizzabile per la parte) | lease_lost
CREATE FUNCTION public.claim_transcription_part_credential(
  p_job_id UUID,
  p_lease_id UUID,
  p_channel_id UUID,
  p_transcription_id UUID,
  p_part_position INTEGER
)
RETURNS TABLE(status TEXT, credential_id UUID, user_id UUID, key_version UUID, retry_limit INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_active UUID;
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
    AND j.lease_expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN
    status := 'lease_lost'; credential_id := NULL; user_id := NULL; key_version := NULL; retry_limit := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT jk.credential_id INTO v_active
  FROM public.transcription_job_credentials AS jk
  WHERE jk.job_id = p_job_id AND jk.status = 'active'
  LIMIT 1;

  SELECT COALESCE(pg_catalog.max(e.ord), 0) INTO v_anchor
  FROM public.transcription_eligible_credentials(p_channel_id) AS e
  WHERE e.credential_id = v_active;

  SELECT e.credential_id, e.user_id, e.key_version, e.retry_limit
  INTO v_credential_id, v_user_id, v_key_version, v_retry_limit
  FROM public.transcription_eligible_credentials(p_channel_id) AS e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.transcription_part_exhausted_keys AS x
    WHERE x.transcription_id = p_transcription_id AND x.part_position = p_part_position
      AND x.credential_id = e.credential_id AND x.key_version = e.key_version
  )
  ORDER BY CASE WHEN e.credential_id = v_active THEN 0 ELSE 1 END,
           CASE WHEN e.ord > v_anchor THEN 0 ELSE 1 END,
           e.ord
  LIMIT 1;

  IF v_credential_id IS NULL THEN
    status := 'none'; credential_id := NULL; user_id := NULL; key_version := NULL; retry_limit := NULL;
  ELSE
    status := 'assigned'; credential_id := v_credential_id; user_id := v_user_id;
    key_version := v_key_version; retry_limit := v_retry_limit;
  END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_transcription_part_key_exhausted(UUID, UUID, UUID, INTEGER, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_transcription_part_credential(UUID, UUID, UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_transcription_part_key_exhausted(UUID, UUID, UUID, INTEGER, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_transcription_part_credential(UUID, UUID, UUID, UUID, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
