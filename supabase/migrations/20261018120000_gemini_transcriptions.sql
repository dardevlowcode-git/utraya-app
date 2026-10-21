-- Commento didattico:
-- Scopo del file: schema additivo delle trascrizioni Gemini con tempi (ADR-019): trascrizione canonica per video,
-- frasi, parti da 120 s, profilo di trascrizione e RPC con lease per il job `transcribe_video`.
-- Flusso: il servizio scrive solo con service_role (RPC fencing sulla lease del job); gli utenti autenticati leggono il canonico.
-- Le tabelle legacy `video_transcripts` e Firecrawl non vengono toccate.

-- ============================================================
-- PROFILO DI TRASCRIZIONE (riga unica, scritta dall'admin dal ticket 05)
-- Prezzi di default: gemini-3.1-flash-lite, tier a pagamento Standard, USD per 1M token:
-- input testo/immagine/video 0.25, output (incluso thinking) 1.50.
-- Fonte: https://ai.google.dev/gemini-api/docs/pricing (verificata il 2026-10-18).
-- ============================================================
CREATE TABLE public.transcription_profile (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-lite'
    CHECK (char_length(model) BETWEEN 1 AND 100 AND model ~ '^[A-Za-z0-9._-]+$'),
  thinking_level TEXT NOT NULL DEFAULT 'minimal'
    CHECK (thinking_level IN ('minimal', 'low', 'medium', 'high')),
  input_price_per_million NUMERIC(12, 6) NOT NULL DEFAULT 0.25 CHECK (input_price_per_million >= 0),
  output_price_per_million NUMERIC(12, 6) NOT NULL DEFAULT 1.50 CHECK (output_price_per_million >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.transcription_profile (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- ============================================================
-- TRASCRIZIONE CANONICA (una per video)
-- ============================================================
CREATE TABLE public.transcriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL UNIQUE REFERENCES public.videos(id) ON DELETE CASCADE,
  language_code TEXT CHECK (language_code IS NULL OR language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'needs_review', 'unavailable')),
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  thinking_level TEXT NOT NULL CHECK (thinking_level IN ('minimal', 'low', 'medium', 'high')),
  requested_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  doubtful_phrase_count INTEGER NOT NULL DEFAULT 0 CHECK (doubtful_phrase_count >= 0),
  missing_part_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_part_count >= 0),
  chunk_seconds INTEGER NOT NULL DEFAULT 120 CHECK (chunk_seconds > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX transcriptions_status_updated_idx
  ON public.transcriptions (status, updated_at DESC)
  WHERE status IN ('pending', 'running', 'needs_review');

-- ============================================================
-- FRASI: `position` = indice parte * 10000 + indice nella parte (ordine stabile con scritture parallele)
-- ============================================================
CREATE TABLE public.transcription_phrases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transcription_id UUID NOT NULL REFERENCES public.transcriptions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  start_seconds INTEGER NOT NULL CHECK (start_seconds >= 0),
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  doubtful_time BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (transcription_id, position)
);

-- ============================================================
-- PARTI (blocchi da 120 s): avanzamento persistente e parti mancanti rilanciabili
-- ============================================================
CREATE TABLE public.transcription_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transcription_id UUID NOT NULL REFERENCES public.transcriptions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  start_seconds INTEGER NOT NULL CHECK (start_seconds >= 0),
  end_seconds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'missing')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_seconds > start_seconds),
  UNIQUE (transcription_id, position)
);

CREATE INDEX transcription_parts_open_idx
  ON public.transcription_parts (transcription_id, position)
  WHERE status <> 'done';

-- Un solo job attivo per video e indice per il recupero del daily-sync.
CREATE UNIQUE INDEX idx_jobs_active_transcription_video
  ON public.jobs ((payload->>'videoId'))
  WHERE job_type = 'transcribe_video' AND status IN ('pending', 'running');

CREATE INDEX idx_jobs_transcription_recovery
  ON public.jobs (status, lease_expires_at, created_at)
  WHERE job_type = 'transcribe_video' AND status IN ('pending', 'running');

-- ============================================================
-- RLS e ACL: lettura canonica per authenticated, scrittura solo service_role
-- ============================================================
ALTER TABLE public.transcription_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcription_phrases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcription_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Transcriptions: read canonical" ON public.transcriptions
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Transcription phrases: read canonical" ON public.transcription_phrases
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Transcription parts: read canonical" ON public.transcription_parts
  FOR SELECT TO authenticated USING (TRUE);

REVOKE ALL ON TABLE public.transcription_profile FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.transcriptions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.transcription_phrases FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.transcription_parts FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.transcriptions TO authenticated;
GRANT SELECT ON TABLE public.transcription_phrases TO authenticated;
GRANT SELECT ON TABLE public.transcription_parts TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.transcription_profile TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transcriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transcription_phrases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transcription_parts TO service_role;

-- ============================================================
-- RPC job `transcribe_video`: claim con attempt, fine attempt, salvataggio parte, finalizzazione
-- ============================================================

-- Reclama un job pending o con lease scaduta e registra l'attempt running nella stessa transazione.
CREATE FUNCTION public.claim_transcription_job_with_attempt(
  p_job_id UUID,
  p_started_at TIMESTAMPTZ,
  p_lease_id UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS TABLE(job_id UUID, lease_id UUID, attempt_id UUID, attempt_number INTEGER, payload JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_attempt_id UUID;
  v_attempt_number INTEGER;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_started_at IS NULL OR p_lease_id IS NULL OR p_lease_expires_at IS NULL
     OR p_lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'invalid_transcription_lease';
  END IF;

  SELECT j.* INTO v_job
  FROM public.jobs AS j
  WHERE j.id = p_job_id
    AND j.job_type = 'transcribe_video'
    AND (j.status = 'pending' OR (j.status = 'running' AND j.lease_expires_at < v_now))
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_job.status = 'running' THEN
    UPDATE public.job_attempts AS a
    SET status = 'failed', completed_at = v_now,
        error_message = 'transcription_lease_expired',
        error_details = pg_catalog.jsonb_build_object('reason', 'lease_recovered')
    WHERE a.job_id = v_job.id AND a.status = 'running';
  END IF;

  SELECT COALESCE(pg_catalog.max(a.attempt_number), 0) INTO v_attempt_number
  FROM public.job_attempts AS a
  WHERE a.job_id = v_job.id;

  -- Tetto di riprese: evita cicli infiniti di continuazione su un job che non avanza.
  IF v_attempt_number >= 50 THEN
    UPDATE public.jobs AS j
    SET status = 'failed', completed_at = v_now, lease_id = NULL, lease_expires_at = NULL,
        error_message = 'transcription_attempt_budget_exhausted'
    WHERE j.id = v_job.id;
    RETURN;
  END IF;

  v_attempt_number := v_attempt_number + 1;
  UPDATE public.jobs AS j
  SET status = 'running', started_at = p_started_at,
      lease_id = p_lease_id, lease_expires_at = p_lease_expires_at,
      completed_at = NULL, error_message = NULL
  WHERE j.id = v_job.id;

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

-- Chiude l'attempt: `pending` rilascia la lease per la continuazione, `completed`/`failed` sono terminali.
CREATE FUNCTION public.finish_transcription_job_attempt(
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
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'completed', 'failed') OR p_completed_at IS NULL THEN
    RAISE EXCEPTION 'invalid_transcription_job_result';
  END IF;

  PERFORM 1 FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.job_type = 'transcribe_video'
    AND j.status = 'running' AND j.lease_id = p_lease_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.job_attempts AS a
  SET status = CASE WHEN p_status = 'failed' THEN 'failed' ELSE 'completed' END,
      completed_at = p_completed_at,
      error_message = p_error_message,
      error_details = COALESCE(p_error_details, pg_catalog.jsonb_build_object('status', p_status))
  WHERE a.id = p_attempt_id AND a.job_id = p_job_id AND a.status = 'running';

  UPDATE public.jobs AS j
  SET status = p_status,
      completed_at = CASE WHEN p_status = 'pending' THEN NULL ELSE p_completed_at END,
      lease_id = NULL, lease_expires_at = NULL,
      error_message = p_error_message
  WHERE j.id = p_job_id;
  RETURN TRUE;
END;
$$;

-- Salva atomicamente l'esito di una parte (frasi incluse) solo se il worker possiede ancora la lease.
-- p_phrases: array JSON di {idx, start_seconds, text, doubtful_time}; idx < 10000.
CREATE FUNCTION public.save_transcription_part(
  p_job_id UUID,
  p_lease_id UUID,
  p_transcription_id UUID,
  p_part_position INTEGER,
  p_status TEXT,
  p_attempts INTEGER,
  p_last_error TEXT,
  p_language_code TEXT,
  p_phrases JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_stride CONSTANT INTEGER := 10000;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'done', 'missing')
     OR p_attempts IS NULL OR p_attempts < 0 OR p_part_position IS NULL OR p_part_position < 0 THEN
    RAISE EXCEPTION 'invalid_transcription_part';
  END IF;

  PERFORM 1 FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.job_type = 'transcribe_video'
    AND j.status = 'running' AND j.lease_id = p_lease_id AND j.lease_expires_at > v_now
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.transcription_parts AS tp
  SET status = p_status, attempts = p_attempts,
      last_error = CASE WHEN p_status = 'done' THEN NULL ELSE pg_catalog.left(p_last_error, 200) END,
      updated_at = v_now
  WHERE tp.transcription_id = p_transcription_id AND tp.position = p_part_position;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transcription_part_not_found';
  END IF;

  IF p_status = 'done' THEN
    DELETE FROM public.transcription_phrases AS ph
    WHERE ph.transcription_id = p_transcription_id
      AND ph.position >= p_part_position * v_stride
      AND ph.position < (p_part_position + 1) * v_stride;

    INSERT INTO public.transcription_phrases (transcription_id, position, start_seconds, text, doubtful_time)
    SELECT p_transcription_id, p_part_position * v_stride + x.idx, x.start_seconds, x.text, COALESCE(x.doubtful_time, FALSE)
    FROM pg_catalog.jsonb_to_recordset(COALESCE(p_phrases, '[]'::JSONB))
      AS x(idx INTEGER, start_seconds INTEGER, text TEXT, doubtful_time BOOLEAN)
    WHERE x.idx >= 0 AND x.idx < v_stride;
  END IF;

  UPDATE public.transcriptions AS t
  SET language_code = COALESCE(t.language_code, p_language_code),
      status = CASE WHEN t.status = 'pending' THEN 'running' ELSE t.status END,
      doubtful_phrase_count = (SELECT pg_catalog.count(*) FROM public.transcription_phrases AS ph
                               WHERE ph.transcription_id = t.id AND ph.doubtful_time),
      missing_part_count = (SELECT pg_catalog.count(*) FROM public.transcription_parts AS tp
                            WHERE tp.transcription_id = t.id AND tp.status = 'missing'),
      updated_at = v_now
  WHERE t.id = p_transcription_id;
  RETURN TRUE;
END;
$$;

-- Calcola lo stato finale; con p_close_pending le parti ancora pending diventano mancanti (job interrotto).
-- Restituisce NULL se la lease è persa, 'running' se restano parti pending.
CREATE FUNCTION public.finalize_transcription(
  p_job_id UUID,
  p_lease_id UUID,
  p_transcription_id UUID,
  p_close_pending BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_pending INTEGER;
  v_missing INTEGER;
  v_doubtful INTEGER;
  v_status TEXT;
BEGIN
  PERFORM 1 FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.job_type = 'transcribe_video'
    AND j.status = 'running' AND j.lease_id = p_lease_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_close_pending THEN
    UPDATE public.transcription_parts AS tp
    SET status = 'missing', last_error = COALESCE(tp.last_error, 'job_stopped'), updated_at = v_now
    WHERE tp.transcription_id = p_transcription_id AND tp.status = 'pending';
  END IF;

  SELECT pg_catalog.count(*) FILTER (WHERE tp.status = 'pending'),
         pg_catalog.count(*) FILTER (WHERE tp.status = 'missing')
  INTO v_pending, v_missing
  FROM public.transcription_parts AS tp
  WHERE tp.transcription_id = p_transcription_id;

  SELECT pg_catalog.count(*) INTO v_doubtful
  FROM public.transcription_phrases AS ph
  WHERE ph.transcription_id = p_transcription_id AND ph.doubtful_time;

  IF v_pending > 0 THEN
    v_status := 'running';
  ELSIF v_missing > 0 OR v_doubtful > 0 THEN
    v_status := 'needs_review';
  ELSE
    v_status := 'complete';
  END IF;

  UPDATE public.transcriptions AS t
  SET status = v_status, doubtful_phrase_count = v_doubtful, missing_part_count = v_missing,
      updated_at = v_now,
      completed_at = CASE WHEN v_status = 'running' THEN NULL ELSE v_now END
  WHERE t.id = p_transcription_id;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_transcription_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_transcription_job_attempt(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_transcription_part(UUID, UUID, UUID, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_transcription(UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_transcription_job_with_attempt(UUID, TIMESTAMPTZ, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_transcription_job_attempt(UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_transcription_part(UUID, UUID, UUID, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_transcription(UUID, UUID, UUID, BOOLEAN) TO service_role;
