-- Commento didattico:
-- Scopo: salva credenziali con insert-if-absent o CAS transazionale per i salvataggi concorrenti.
-- Flusso: blocca retry setting/versione prima della credenziale e azzera la policy solo se il segreto è cambiato.

CREATE OR REPLACE FUNCTION public.save_user_provider_credential_atomic(
  p_credential_id UUID,
  p_user_id UUID,
  p_provider TEXT,
  p_encrypted_key TEXT,
  p_expected_encrypted_key TEXT,
  p_expected_key_version UUID,
  p_reset_retry_policy BOOLEAN
)
RETURNS TABLE(status TEXT, credential_id UUID, retry_limit INTEGER, key_version UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_credential_id UUID;
  v_encrypted_key TEXT;
  v_retry_limit INTEGER;
  v_key_version UUID;
BEGIN
  IF p_user_id IS NULL OR p_provider IS NULL
     OR p_provider NOT IN ('youtube', 'gemini', 'firecrawl')
     OR p_encrypted_key IS NULL OR pg_catalog.btrim(p_encrypted_key) = ''
     OR p_reset_retry_policy IS NULL THEN
    RAISE EXCEPTION 'invalid_provider_credential_save';
  END IF;

  IF p_credential_id IS NULL THEN
    IF p_expected_encrypted_key IS NOT NULL OR p_expected_key_version IS NOT NULL OR p_reset_retry_policy THEN
      RAISE EXCEPTION 'invalid_new_provider_credential_expectation';
    END IF;

    INSERT INTO public.user_provider_credentials (
      user_id, provider, encrypted_key, is_configured, is_valid, last_error, last_used_at
    ) VALUES (
      p_user_id, p_provider, p_encrypted_key, TRUE, NULL, NULL, NULL
    )
    ON CONFLICT (user_id, provider) DO NOTHING
    RETURNING id INTO v_credential_id;

    IF NOT FOUND THEN
      status := 'conflict';
      credential_id := NULL;
      retry_limit := NULL;
      key_version := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    SELECT retry.retry_limit, retry.key_version
    INTO v_retry_limit, v_key_version
    FROM public.user_provider_credential_retry_limits AS retry
    WHERE retry.credential_id = v_credential_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'credential_retry_setting_missing'; END IF;

    status := 'saved';
    credential_id := v_credential_id;
    retry_limit := v_retry_limit;
    key_version := v_key_version;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_expected_key_version IS NULL THEN
    RAISE EXCEPTION 'missing_expected_provider_key_version';
  END IF;

  -- Stesso lock order dei claim: retry setting/key-version, poi credenziale.
  PERFORM 1
  FROM public.user_provider_credential_retry_limits AS retry
  WHERE retry.credential_id = p_credential_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'credential_retry_setting_missing'; END IF;

  SELECT credential.id, credential.encrypted_key
  INTO v_credential_id, v_encrypted_key
  FROM public.user_provider_credentials AS credential
  WHERE credential.id = p_credential_id
    AND credential.user_id = p_user_id
    AND credential.provider = p_provider
  FOR UPDATE;
  IF NOT FOUND THEN
    status := 'conflict';
    credential_id := NULL;
    retry_limit := NULL;
    key_version := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT retry.retry_limit, retry.key_version
  INTO v_retry_limit, v_key_version
  FROM public.user_provider_credential_retry_limits AS retry
  WHERE retry.credential_id = p_credential_id;

  IF v_encrypted_key IS DISTINCT FROM p_expected_encrypted_key
     OR v_key_version IS DISTINCT FROM p_expected_key_version THEN
    status := 'conflict';
    credential_id := NULL;
    retry_limit := NULL;
    key_version := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_reset_retry_policy THEN
    UPDATE public.user_provider_credential_retry_limits AS retry
    SET retry_limit = 0,
        key_version = pg_catalog.gen_random_uuid()
    WHERE retry.credential_id = p_credential_id
    RETURNING retry.retry_limit, retry.key_version INTO v_retry_limit, v_key_version;
  END IF;

  UPDATE public.user_provider_credentials AS credential
  SET encrypted_key = p_encrypted_key,
      is_configured = TRUE,
      is_valid = NULL,
      last_error = NULL,
      last_used_at = NULL
  WHERE credential.id = p_credential_id
    AND credential.user_id = p_user_id
    AND credential.provider = p_provider;

  status := 'saved';
  credential_id := v_credential_id;
  retry_limit := v_retry_limit;
  key_version := v_key_version;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.save_user_provider_credential_atomic(UUID, UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_user_provider_credential_atomic(UUID, UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN)
  TO service_role;

NOTIFY pgrst, 'reload schema';
