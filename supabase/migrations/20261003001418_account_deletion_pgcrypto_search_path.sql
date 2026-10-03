-- Commento didattico:
-- Scopo: corregge la risoluzione pgcrypto nella cancellazione account su Supabase.
-- Flusso: sostituisce la funzione hardenizzata qualificando gen_random_bytes nello schema extensions.

CREATE OR REPLACE FUNCTION public.execute_user_deletion(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_deletion_requests
  SET status = 'cancelled', cancelled_at = NOW(), executing_at = NULL, error_details = 'force_deleted'
  WHERE user_id = p_user_id AND status = 'pending';

  UPDATE public.jobs SET created_by_user_id = NULL WHERE created_by_user_id = p_user_id;
  UPDATE public.video_analysis SET analyzed_by_user_id = NULL WHERE analyzed_by_user_id = p_user_id;
  UPDATE public.audit_logs SET user_id = NULL WHERE user_id = p_user_id;
  UPDATE public.legal_acceptances SET user_id = NULL WHERE user_id = p_user_id;
  UPDATE public.user_provider_credentials
  SET encrypted_key = 'burned:' || encode(extensions.gen_random_bytes(64), 'hex')
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

REVOKE EXECUTE ON FUNCTION public.execute_user_deletion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_user_deletion(UUID) TO service_role;
