-- Commento didattico:
-- Scopo: registra metadati minimali delle chiamate effettuate con le credenziali API personali.
-- Flusso: i service server-side inseriscono eventi; l'utente legge solo i propri eventi entro 30 giorni; il cron elimina lo storico scaduto.

CREATE TABLE public.api_usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('youtube', 'gemini')),
  operation TEXT NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 80),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'http_error', 'network_error', 'timeout')),
  http_status SMALLINT CHECK (http_status BETWEEN 100 AND 599),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN ('provider_error', 'network_error', 'timeout', 'unknown')),
  model TEXT CHECK (model IS NULL OR char_length(model) <= 100),
  input_tokens BIGINT CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens BIGINT CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens BIGINT CHECK (total_tokens IS NULL OR total_tokens >= 0),
  estimated_cost_usd NUMERIC(18, 9) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  input_rate_usd_per_million NUMERIC(12, 6) CHECK (input_rate_usd_per_million IS NULL OR input_rate_usd_per_million >= 0),
  output_rate_usd_per_million NUMERIC(12, 6) CHECK (output_rate_usd_per_million IS NULL OR output_rate_usd_per_million >= 0),
  quota_units INTEGER CHECK (quota_units IS NULL OR quota_units >= 1),
  quota_bucket TEXT CHECK (quota_bucket IS NULL OR quota_bucket IN ('default', 'search')),
  CONSTRAINT api_usage_provider_fields_check CHECK (
    (provider = 'youtube' AND input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL AND estimated_cost_usd IS NULL)
    OR
    (provider = 'gemini' AND quota_units IS NULL AND quota_bucket IS NULL)
  )
);

CREATE INDEX api_usage_events_user_time_idx
  ON public.api_usage_events(user_id, occurred_at DESC);
CREATE INDEX api_usage_events_time_idx
  ON public.api_usage_events(occurred_at);

ALTER TABLE public.api_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "API usage: read own" ON public.api_usage_events
  FOR SELECT USING (
    user_id = auth.uid()
    AND occurred_at >= NOW() - INTERVAL '30 days'
  );

REVOKE ALL ON TABLE public.api_usage_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.api_usage_events TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.api_usage_events TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_api_usage_summary(p_since TIMESTAMPTZ)
RETURNS TABLE (
  provider TEXT,
  request_count BIGINT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  total_tokens BIGINT,
  estimated_cost_usd NUMERIC,
  quota_units BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    usage.provider,
    COUNT(*)::BIGINT,
    COALESCE(SUM(usage.input_tokens), 0)::BIGINT,
    COALESCE(SUM(usage.output_tokens), 0)::BIGINT,
    COALESCE(SUM(usage.total_tokens), 0)::BIGINT,
    COALESCE(SUM(usage.estimated_cost_usd), 0),
    COALESCE(SUM(usage.quota_units), 0)::BIGINT
  FROM public.api_usage_events AS usage
  WHERE usage.user_id = (SELECT auth.uid())
    AND usage.occurred_at >= p_since
  GROUP BY usage.provider;
$$;

REVOKE ALL ON FUNCTION public.get_my_api_usage_summary(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_api_usage_summary(TIMESTAMPTZ) TO authenticated;
