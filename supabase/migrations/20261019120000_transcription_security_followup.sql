-- Commento didattico:
-- Scopo del file: chiude tre rilievi di sicurezza prima della produzione sulle trascrizioni Gemini.
--   K2: la lettura anonima `USING (TRUE)` viene ristretta ai video dei canali seguiti attivamente
--       (stesso schema dell'hardening `20260924153504`), e `requested_by_user_id`/`last_error`
--       non sono più leggibili dal ruolo `authenticated`.
--   K5: l'eleggibilità per la rotazione esclude chiavi di utenti non attivi e di utenti che non
--       hanno accettato la versione TOS correntemente richiesta.
--   K6: la funzione trigger SECURITY DEFINER perde l'esecuzione pubblica.
-- Flusso: migration additiva e idempotente; le precedenti restano invariate. Il worker continua a
--   scrivere con `service_role` (non soggetto a RLS né ai revoke di colonna), quindi nessun percorso
--   applicativo cambia.

-- ============================================================
-- K2 — RLS: sola lettura dei canali seguiti attivamente, come l'hardening 20260924153504
-- ============================================================
DROP POLICY IF EXISTS "Transcriptions: read canonical" ON public.transcriptions;
DROP POLICY IF EXISTS "Transcriptions: followed video read" ON public.transcriptions;
CREATE POLICY "Transcriptions: followed video read" ON public.transcriptions
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.videos v
      JOIN public.user_channels uc ON uc.channel_id = v.channel_id
      WHERE v.id = transcriptions.video_id
        AND uc.user_id = (SELECT auth.uid())
        AND uc.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Transcription phrases: read canonical" ON public.transcription_phrases;
DROP POLICY IF EXISTS "Transcription phrases: followed video read" ON public.transcription_phrases;
CREATE POLICY "Transcription phrases: followed video read" ON public.transcription_phrases
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.transcriptions t
      JOIN public.videos v ON v.id = t.video_id
      JOIN public.user_channels uc ON uc.channel_id = v.channel_id
      WHERE t.id = transcription_phrases.transcription_id
        AND uc.user_id = (SELECT auth.uid())
        AND uc.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Transcription parts: read canonical" ON public.transcription_parts;
DROP POLICY IF EXISTS "Transcription parts: followed video read" ON public.transcription_parts;
CREATE POLICY "Transcription parts: followed video read" ON public.transcription_parts
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.transcriptions t
      JOIN public.videos v ON v.id = t.video_id
      JOIN public.user_channels uc ON uc.channel_id = v.channel_id
      WHERE t.id = transcription_parts.transcription_id
        AND uc.user_id = (SELECT auth.uid())
        AND uc.is_active = TRUE
    )
  );

-- K2 — colonne sensibili non leggibili da `authenticated`: chi ha richiesto la trascrizione e gli
-- errori interni delle parti restano visibili solo a `service_role` (che mantiene i privilegi pieni).
REVOKE SELECT ON TABLE public.transcriptions FROM authenticated;
GRANT SELECT (id, video_id, language_code, status, model, thinking_level,
              doubtful_phrase_count, missing_part_count, chunk_seconds,
              created_at, updated_at, completed_at)
  ON TABLE public.transcriptions TO authenticated;

REVOKE SELECT ON TABLE public.transcription_parts FROM authenticated;
GRANT SELECT (id, transcription_id, position, start_seconds, end_seconds, status, attempts, updated_at)
  ON TABLE public.transcription_parts TO authenticated;

-- ============================================================
-- K5 — Eleggibilità della rotazione: utente attivo e TOS correnti accettati
-- ============================================================
-- L'unica versione TOS SQL è esposta da una funzione esplicita e confrontata dal test Vitest con il gate app.
CREATE OR REPLACE FUNCTION public.required_tos_version()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '2026-10-11-1'::TEXT
$$;

REVOKE ALL ON FUNCTION public.required_tos_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.required_tos_version() TO service_role;

-- Questa funzione è la sola fonte per l'eleggibilità sia nella rotazione sia nella chiave del richiedente.
CREATE OR REPLACE FUNCTION public.transcription_eligible_credentials(p_channel_id UUID)
RETURNS TABLE(credential_id UUID, user_id UUID, key_version UUID, retry_limit INTEGER, added_at TIMESTAMPTZ, ord BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.id, c.user_id, l.key_version, l.retry_limit, uc.added_at,
         pg_catalog.row_number() OVER (ORDER BY uc.added_at, uc.user_id, c.id)
  FROM public.user_channels AS uc
  JOIN public.users AS u ON u.id = uc.user_id
  JOIN public.user_provider_credentials AS c ON c.user_id = uc.user_id AND c.provider = 'gemini'
  JOIN public.user_provider_credential_retry_limits AS l ON l.credential_id = c.id
  WHERE uc.channel_id = p_channel_id
    AND uc.is_active = TRUE
    AND u.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.legal_acceptances AS la
      WHERE la.user_id = uc.user_id
        AND la.document_kind = 'tos'
        AND la.document_version = public.required_tos_version()
    )
    AND c.is_configured = TRUE
    AND c.encrypted_key IS NOT NULL
    AND c.is_valid IS DISTINCT FROM FALSE
$$;

-- ============================================================
-- K6 — funzione trigger SECURITY DEFINER senza esecuzione pubblica
-- ============================================================
REVOKE ALL ON FUNCTION public.initialize_user_provider_credential_retry_limit() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
