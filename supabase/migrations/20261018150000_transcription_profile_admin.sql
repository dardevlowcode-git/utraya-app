-- Commento didattico:
-- Scopo del file: profilo di trascrizione amministrativo (ticket 05), con aggiornamento atomico e audit senza segreti.
-- La sessione admin e' separata dagli utenti, quindi l'audit registra lo username admin in una tabella dedicata.
-- Flusso: la RPC `update_transcription_profile` (solo service_role) blocca la riga, aggiorna e scrive l'audit nella stessa transazione.

CREATE TABLE public.transcription_profile_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_username TEXT NOT NULL CHECK (char_length(admin_username) BETWEEN 1 AND 200),
  previous_values JSONB NOT NULL,
  new_values JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX transcription_profile_audit_created_idx
  ON public.transcription_profile_audit (created_at DESC);

ALTER TABLE public.transcription_profile_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transcription_profile_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.transcription_profile_audit TO service_role;

-- Aggiorna il profilo unico e scrive l'audit nella stessa transazione; restituisce i valori salvati.
CREATE FUNCTION public.update_transcription_profile(
  p_model TEXT,
  p_thinking_level TEXT,
  p_input_price NUMERIC,
  p_output_price NUMERIC,
  p_admin_username TEXT
)
RETURNS TABLE(model TEXT, thinking_level TEXT, input_price_per_million NUMERIC, output_price_per_million NUMERIC, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_previous JSONB;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    'model', p.model, 'thinking_level', p.thinking_level,
    'input_price_per_million', p.input_price_per_million, 'output_price_per_million', p.output_price_per_million
  ) INTO v_previous
  FROM public.transcription_profile AS p WHERE p.id = TRUE FOR UPDATE;

  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'profilo di trascrizione assente' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.transcription_profile AS p
  SET model = p_model, thinking_level = p_thinking_level,
      input_price_per_million = p_input_price, output_price_per_million = p_output_price,
      updated_at = pg_catalog.now()
  WHERE p.id = TRUE
  RETURNING p.model, p.thinking_level, p.input_price_per_million, p.output_price_per_million, p.updated_at;

  INSERT INTO public.transcription_profile_audit (admin_username, previous_values, new_values)
  VALUES (
    p_admin_username, v_previous,
    pg_catalog.jsonb_build_object(
      'model', p_model, 'thinking_level', p_thinking_level,
      'input_price_per_million', p_input_price, 'output_price_per_million', p_output_price
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_transcription_profile(TEXT, TEXT, NUMERIC, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_transcription_profile(TEXT, TEXT, NUMERIC, NUMERIC, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
