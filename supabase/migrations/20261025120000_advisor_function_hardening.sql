-- Commento didattico:
-- Scopo del file: riduce l'esecuzione diretta della funzione trigger e fissa il search_path
-- delle funzioni operative segnalate dagli advisor Supabase.
-- Flusso: il trigger resta attivo; le funzioni usano riferimenti qualificati anche con search_path vuoto.
--
-- Rollback SQL (ripristina i privilegi e i corpi precedenti):
-- GRANT EXECUTE ON FUNCTION public.initialize_user_provider_credential_retry_limit() TO PUBLIC, anon, authenticated;
-- ALTER FUNCTION public.update_updated_at_column() RESET search_path;
-- CREATE OR REPLACE FUNCTION public.update_updated_at_column()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.updated_at = NOW();
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- ALTER FUNCTION public.cleanup_old_logs() RESET search_path;
-- CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
-- RETURNS void AS $$
-- BEGIN
--   DELETE FROM app_logs WHERE created_at < NOW() - INTERVAL '7 days';
--   DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '7 days';
--   DELETE FROM job_locks WHERE expires_at < NOW();
-- END;
-- $$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.initialize_user_provider_credential_retry_limit()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.app_logs WHERE created_at < pg_catalog.now() - INTERVAL '7 days';
  DELETE FROM public.audit_logs WHERE created_at < pg_catalog.now() - INTERVAL '7 days';
  DELETE FROM public.job_locks WHERE expires_at < pg_catalog.now();
END;
$$;

ALTER FUNCTION public.cleanup_old_logs() SET search_path = '';
