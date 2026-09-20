-- Commento didattico:
-- Scopo del file: introduce flusso cancellazione account con grace period, cron executor e funzione server-side di purge/anonimizzazione.
-- Moduli richiamati: schema `public`, `auth.users`, estensione `pgcrypto`.
-- Flusso: crea richieste cancellazione, abilita execution service-role e preserva prove legali anonimizzate.

-- ============================================================
-- Migration 007: user_deletion_requests + execute_user_deletion
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_deletion_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'executing', 'completed', 'failed')),
  reason TEXT,
  ip_address INET,
  user_agent TEXT,
  cancelled_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  error_details TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_deletion_status_scheduled
  ON public.user_deletion_requests(status, scheduled_deletion_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_deletion_one_pending
  ON public.user_deletion_requests(user_id)
  WHERE status = 'pending' AND user_id IS NOT NULL;

ALTER TABLE public.user_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deletion requests: read own"
  ON public.user_deletion_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Deletion requests: read admin"
  ON public.user_deletion_requests FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.execute_user_deletion(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.legal_acceptances
    SET user_id = NULL
    WHERE user_id = p_user_id;

  UPDATE public.user_provider_credentials
    SET encrypted_key = 'burned:' || encode(gen_random_bytes(64), 'hex')
    WHERE user_id = p_user_id;

  UPDATE public.user_roles SET assigned_by = NULL WHERE assigned_by = p_user_id;
  UPDATE public.allowlist_entries SET added_by = NULL WHERE added_by = p_user_id;

  DELETE FROM public.admin_actions_audit WHERE admin_user_id = p_user_id;
  DELETE FROM public.user_provider_credentials WHERE user_id = p_user_id;
  DELETE FROM public.user_video_states WHERE user_id = p_user_id;
  DELETE FROM public.user_channels WHERE user_id = p_user_id;
  DELETE FROM public.watchlists WHERE user_id = p_user_id;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  DELETE FROM public.user_identities WHERE user_id = p_user_id;
  DELETE FROM public.users WHERE id = p_user_id;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_user_deletion(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_user_deletion(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_user_deletion(UUID) TO service_role;