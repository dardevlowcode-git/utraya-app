-- Commento didattico:
-- Scopo del file: restringe esplicitamente i privilegi della tabella diagnostica temporanea.
-- Flusso: rimuove ACL predefiniti del ruolo privilegiato, poi ri-concede solo le operazioni richieste.

REVOKE ALL ON TABLE public.transcript_fetch_diagnostics
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, DELETE ON TABLE public.transcript_fetch_diagnostics
  TO service_role;
