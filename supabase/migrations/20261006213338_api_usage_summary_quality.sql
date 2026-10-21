-- Commento didattico:
-- Scopo: preserva aggregati API ignoti/parziali e conteggia i record registrati senza metadati d’uso completi.
-- Flusso: la RPC continua a rispettare l’utente RLS, lasciando NULL le somme per cui non esiste un valore noto.

DROP FUNCTION IF EXISTS public.get_my_api_usage_summary(TIMESTAMPTZ);

CREATE FUNCTION public.get_my_api_usage_summary(p_since TIMESTAMPTZ)
RETURNS TABLE (
  provider TEXT,
  request_count BIGINT,
  input_tokens BIGINT,
  output_tokens BIGINT,
  total_tokens BIGINT,
  estimated_cost_usd NUMERIC,
  quota_units BIGINT,
  unknown_usage_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    usage.provider,
    COUNT(*)::BIGINT,
    SUM(usage.input_tokens)::BIGINT,
    SUM(usage.output_tokens)::BIGINT,
    SUM(usage.total_tokens)::BIGINT,
    SUM(usage.estimated_cost_usd),
    SUM(usage.quota_units)::BIGINT,
    (COUNT(*) FILTER (
      WHERE (usage.provider = 'gemini' AND (
        usage.input_tokens IS NULL
        OR usage.output_tokens IS NULL
        OR usage.total_tokens IS NULL
        OR usage.estimated_cost_usd IS NULL
      ))
      OR (usage.provider = 'youtube' AND usage.quota_units IS NULL)
    ))::BIGINT
  FROM public.api_usage_events AS usage
  WHERE usage.user_id = (SELECT auth.uid())
    AND usage.occurred_at >= p_since
  GROUP BY usage.provider;
$$;

REVOKE ALL ON FUNCTION public.get_my_api_usage_summary(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_api_usage_summary(TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
