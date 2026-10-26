-- Commento didattico:
-- Scopo: mantenere il gate DB allineato alla versione TOS richiesta dall'app.
-- Flusso: aggiorna la versione restituita e preserva i privilegi della funzione.
CREATE OR REPLACE FUNCTION public.required_tos_version()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '2026-10-25-1'::TEXT
$$;

REVOKE ALL ON FUNCTION public.required_tos_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.required_tos_version() TO service_role;
