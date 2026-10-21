-- Commento didattico:
-- Scopo del file: persiste limiti retry amministrativi, separati dalle credenziali e dalle env.
-- Flusso: defaulta le chiavi private a zero, configura YouTube condiviso a dieci e nega accesso diretto agli utenti.

CREATE TABLE IF NOT EXISTS public.user_provider_credential_retry_limits (
  credential_id UUID PRIMARY KEY REFERENCES public.user_provider_credentials(id) ON DELETE CASCADE,
  retry_limit   INTEGER NOT NULL DEFAULT 0 CHECK (retry_limit >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shared_provider_retry_settings (
  provider_key TEXT PRIMARY KEY CHECK (provider_key = 'youtube_innertube'),
  retry_limit  INTEGER NOT NULL DEFAULT 10 CHECK (retry_limit >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_provider_credential_retry_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_provider_retry_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_provider_credential_retry_limits FROM anon, authenticated;
REVOKE ALL ON TABLE public.shared_provider_retry_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.initialize_user_provider_credential_retry_limit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_provider_credential_retry_limits (credential_id, retry_limit)
  VALUES (NEW.id, 0)
  ON CONFLICT (credential_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS user_provider_credential_retry_limit_insert ON public.user_provider_credentials;
CREATE TRIGGER user_provider_credential_retry_limit_insert
  AFTER INSERT ON public.user_provider_credentials
  FOR EACH ROW EXECUTE FUNCTION public.initialize_user_provider_credential_retry_limit();

CREATE OR REPLACE FUNCTION public.update_retry_setting_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS user_provider_credential_retry_limits_updated_at ON public.user_provider_credential_retry_limits;
CREATE TRIGGER user_provider_credential_retry_limits_updated_at
  BEFORE UPDATE ON public.user_provider_credential_retry_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_retry_setting_updated_at();

DROP TRIGGER IF EXISTS shared_provider_retry_settings_updated_at ON public.shared_provider_retry_settings;
CREATE TRIGGER shared_provider_retry_settings_updated_at
  BEFORE UPDATE ON public.shared_provider_retry_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_retry_setting_updated_at();

INSERT INTO public.user_provider_credential_retry_limits (credential_id, retry_limit)
SELECT id, 0
FROM public.user_provider_credentials
ON CONFLICT (credential_id) DO NOTHING;

INSERT INTO public.shared_provider_retry_settings (provider_key, retry_limit)
VALUES ('youtube_innertube', 10)
ON CONFLICT (provider_key) DO NOTHING;
