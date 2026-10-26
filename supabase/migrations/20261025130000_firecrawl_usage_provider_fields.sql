-- Commento didattico:
-- Scopo: allinea il vincolo dei campi di consumo ai provider registrati, consentendo eventi Firecrawl senza usage inventato.
-- Rollback:
-- ALTER TABLE public.api_usage_events DROP CONSTRAINT IF EXISTS api_usage_provider_fields_check;
-- ALTER TABLE public.api_usage_events ADD CONSTRAINT api_usage_provider_fields_check CHECK (
--   (provider = 'youtube' AND input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL AND estimated_cost_usd IS NULL)
--   OR
--   (provider = 'gemini' AND quota_units IS NULL AND quota_bucket IS NULL)
-- );

ALTER TABLE public.api_usage_events
  DROP CONSTRAINT IF EXISTS api_usage_provider_fields_check;

ALTER TABLE public.api_usage_events
  ADD CONSTRAINT api_usage_provider_fields_check CHECK (
    (provider = 'youtube' AND input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL AND estimated_cost_usd IS NULL)
    OR
    (provider = 'gemini' AND quota_units IS NULL AND quota_bucket IS NULL)
    OR
    (provider = 'firecrawl'
      AND model IS NULL
      AND input_tokens IS NULL
      AND output_tokens IS NULL
      AND total_tokens IS NULL
      AND estimated_cost_usd IS NULL
      AND input_rate_usd_per_million IS NULL
      AND output_rate_usd_per_million IS NULL
      AND quota_units IS NULL
      AND quota_bucket IS NULL)
  );
