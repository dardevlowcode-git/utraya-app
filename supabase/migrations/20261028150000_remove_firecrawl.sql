-- Commento didattico:
-- Scopo: elimina il provider non più utilizzato e le tabelle del vecchio recupero trascrizioni.
-- Flusso: prima rimuove i dati dipendenti, poi restringe i controlli e gli RPC, infine elimina gli oggetti legacy.

DELETE FROM public.channel_scan_provider_requests WHERE provider = 'firecrawl';
DELETE FROM public.channel_scan_job_credentials WHERE provider = 'firecrawl';
DELETE FROM public.channel_scan_key_rotation_cursors WHERE provider = 'firecrawl';
DELETE FROM public.api_usage_events WHERE provider = 'firecrawl';
DELETE FROM public.jobs
WHERE job_type = 'validate_provider_credential'
  AND (payload->>'provider' = 'firecrawl'
       OR payload->>'credentialId' IN (
         SELECT id::text FROM public.user_provider_credentials WHERE provider = 'firecrawl'
       ));
DELETE FROM public.user_provider_credentials WHERE provider = 'firecrawl';
DELETE FROM public.cron_settings WHERE schedule_key = 'transcripts';

ALTER TABLE public.user_provider_credentials DROP CONSTRAINT user_provider_credentials_provider_check;
ALTER TABLE public.user_provider_credentials ADD CONSTRAINT user_provider_credentials_provider_check CHECK (provider IN ('youtube', 'gemini'));
ALTER TABLE public.api_usage_events DROP CONSTRAINT api_usage_events_provider_check;
ALTER TABLE public.api_usage_events ADD CONSTRAINT api_usage_events_provider_check CHECK (provider IN ('youtube', 'gemini'));
ALTER TABLE public.api_usage_events DROP CONSTRAINT api_usage_provider_fields_check;
ALTER TABLE public.api_usage_events ADD CONSTRAINT api_usage_provider_fields_check CHECK (
  (provider = 'youtube' AND input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL AND estimated_cost_usd IS NULL)
  OR (provider = 'gemini' AND quota_units IS NULL AND quota_bucket IS NULL)
);
ALTER TABLE public.channel_scan_key_rotation_cursors DROP CONSTRAINT channel_scan_key_rotation_cursors_provider_check;
ALTER TABLE public.channel_scan_key_rotation_cursors ADD CONSTRAINT channel_scan_key_rotation_cursors_provider_check CHECK (provider = 'youtube');
ALTER TABLE public.channel_scan_job_credentials DROP CONSTRAINT channel_scan_job_credentials_provider_check;
ALTER TABLE public.channel_scan_job_credentials ADD CONSTRAINT channel_scan_job_credentials_provider_check CHECK (provider = 'youtube');
ALTER TABLE public.channel_scan_provider_requests DROP CONSTRAINT channel_scan_provider_requests_provider_check;
ALTER TABLE public.channel_scan_provider_requests ADD CONSTRAINT channel_scan_provider_requests_provider_check CHECK (provider = 'youtube');

-- Conserva corpo, privilegi e configurazione degli RPC esistenti; interrompe la migrazione
-- se il testo atteso non coincide, anziché applicare una modifica parziale.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_credential_validation_job_with_attempt(uuid,timestamp with time zone,uuid,timestamp with time zone)',
    'public.save_user_provider_credential_atomic(uuid,uuid,text,text,text,uuid,boolean)'
  ] LOOP
    SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_definition;
    v_old := $$('youtube', 'gemini', 'firecrawl')$$;
    IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'unexpected provider validation in %', v_signature; END IF;
    EXECUTE replace(v_definition, v_old, $$('youtube', 'gemini')$$);
  END LOOP;

  SELECT pg_get_functiondef('public.get_my_api_usage_summary(timestamp with time zone)'::regprocedure) INTO v_definition;
  v_old := $$      OR usage.provider = 'firecrawl'
$$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'unexpected usage summary'; END IF;
  EXECUTE replace(v_definition, v_old, '');

  SELECT pg_get_functiondef('public.claim_channel_scan_provider_request(uuid,uuid,uuid,text,text)'::regprocedure) INTO v_definition;
  v_old := $$('youtube', 'firecrawl')$$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'unexpected scan provider validation'; END IF;
  v_definition := replace(v_definition, v_old, $$('youtube')$$);
  v_old := $$    AND (
      j.payload->>'channelId' = p_channel_id::TEXT
      OR (p_provider = 'firecrawl' AND EXISTS (
        SELECT 1 FROM public.channel_scan_firecrawl_transcript_targets AS target
        WHERE target.job_id = j.id AND target.channel_id = p_channel_id AND target.status = 'pending'
      ))
    )$$;
  v_new := $$    AND j.payload->>'channelId' = p_channel_id::TEXT$$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'unexpected scan channel authorization'; END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := $$  IF p_provider = 'firecrawl'
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

$$;
  IF strpos(v_definition, v_old) = 0 THEN RAISE EXCEPTION 'unexpected scan recovery gate'; END IF;
  v_definition := replace(v_definition, v_old, '');
  IF v_definition ILIKE '%firecrawl%' THEN RAISE EXCEPTION 'legacy scan reference remains'; END IF;
  EXECUTE v_definition;
END;
$migration$;

DROP FUNCTION IF EXISTS public.complete_firecrawl_transcript_recovery_target(uuid,uuid,uuid,text,text,text,text);
DROP TABLE IF EXISTS public.channel_scan_firecrawl_transcript_targets;
DROP TABLE IF EXISTS public.firecrawl_transcript_recovery_settings;
DROP TABLE IF EXISTS public.video_transcripts;
DROP TABLE IF EXISTS public.transcript_fetch_diagnostics;
