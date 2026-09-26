-- Commento didattico:
-- Scopo del file: chiude i confini di ownership/RLS, rende atomiche le transizioni
-- di cancellazione account e rimuove l'esecuzione pubblica di funzioni operative.
-- Flusso: migrazione correttiva applicabile dopo lo schema base e prima delle verifiche live.

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_created_by_user_id_fkey;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.video_analysis DROP CONSTRAINT IF EXISTS video_analysis_analyzed_by_user_id_fkey;
ALTER TABLE public.video_analysis
  ADD CONSTRAINT video_analysis_analyzed_by_user_id_fkey
  FOREIGN KEY (analyzed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.user_deletion_requests
  ADD COLUMN IF NOT EXISTS executing_at TIMESTAMPTZ;

DROP POLICY IF EXISTS "Users: update own" ON public.users;
CREATE POLICY "Users: update own" ON public.users
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()) AND status = 'active')
  WITH CHECK (id = (select auth.uid()) AND status = 'active');

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = (SELECT auth.uid())
      AND r.name = 'super_admin'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_current_user_allowlisted()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM auth.users au
    JOIN public.allowlist_entries ae ON lower(ae.email) = lower(au.email)
    WHERE au.id = (SELECT auth.uid())
      AND ae.is_active = TRUE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_current_user_allowlisted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_allowlisted() TO authenticated, service_role;

DROP POLICY IF EXISTS "Video analysis: authenticated read" ON public.video_analysis;
CREATE POLICY "Video analysis: followed video read" ON public.video_analysis
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.videos v
      JOIN public.user_channels uc ON uc.channel_id = v.channel_id
      WHERE v.id = video_analysis.video_id
        AND uc.user_id = (select auth.uid())
        AND uc.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Localized content: authenticated read" ON public.video_localized_content;
CREATE POLICY "Localized content: followed video read" ON public.video_localized_content
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.videos v
      JOIN public.user_channels uc ON uc.channel_id = v.channel_id
      WHERE v.id = video_localized_content.video_id
        AND uc.user_id = (select auth.uid())
        AND uc.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Sync state: authenticated read" ON public.canonical_sync_state;
CREATE POLICY "Sync state: followed channel read" ON public.canonical_sync_state
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.user_channels uc
      WHERE uc.channel_id = canonical_sync_state.channel_id
        AND uc.user_id = (select auth.uid())
        AND uc.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "User video states: own" ON public.user_video_states;
CREATE POLICY "User video states: own followed video" ON public.user_video_states
  FOR ALL TO authenticated
  USING (
    (user_id = (select auth.uid()) OR public.is_super_admin())
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.videos v
        JOIN public.user_channels uc ON uc.channel_id = v.channel_id
        WHERE v.id = user_video_states.video_id
          AND uc.user_id = (select auth.uid())
          AND uc.is_active = TRUE
      )
    )
  )
  WITH CHECK (
    (user_id = (select auth.uid()) OR public.is_super_admin())
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.videos v
        JOIN public.user_channels uc ON uc.channel_id = v.channel_id
        WHERE v.id = user_video_states.video_id
          AND uc.user_id = (select auth.uid())
          AND uc.is_active = TRUE
      )
    )
  );

DROP POLICY IF EXISTS "Watchlist items: own" ON public.watchlist_items;
CREATE POLICY "Watchlist items: own followed video" ON public.watchlist_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.watchlists w
      JOIN public.videos v ON v.id = watchlist_items.video_id
      JOIN public.user_channels uc ON uc.channel_id = v.channel_id
      WHERE w.id = watchlist_id
        AND (w.user_id = (select auth.uid()) OR public.is_super_admin())
        AND (public.is_super_admin() OR (uc.user_id = (select auth.uid()) AND uc.is_active = TRUE))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.watchlists w
      JOIN public.videos v ON v.id = watchlist_items.video_id
      JOIN public.user_channels uc ON uc.channel_id = v.channel_id
      WHERE w.id = watchlist_id
        AND (w.user_id = (select auth.uid()) OR public.is_super_admin())
        AND (public.is_super_admin() OR (uc.user_id = (select auth.uid()) AND uc.is_active = TRUE))
    )
  );

REVOKE EXECUTE ON FUNCTION public.cleanup_old_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_logs() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_account_deletion(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id UUID;
BEGIN
  UPDATE public.user_deletion_requests
  SET status = 'executing', executing_at = NOW()
  WHERE id = p_request_id
    AND (
      status = 'pending'
      OR (status = 'executing' AND executing_at < NOW() - INTERVAL '15 minutes')
    )
  RETURNING id INTO claimed_id;
  RETURN claimed_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_account_deletion(
  p_user_id UUID,
  p_reason TEXT,
  p_ip_address INET,
  p_user_agent TEXT,
  p_scheduled_at TIMESTAMPTZ
)
RETURNS TABLE(request_id UUID, scheduled_for TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_status TEXT;
  existing_id UUID;
  existing_scheduled TIMESTAMPTZ;
  suspension_time TIMESTAMPTZ;
BEGIN
  SELECT status INTO user_status
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF user_status IS NULL OR user_status <> 'active' THEN
    RAISE EXCEPTION 'account_not_active' USING ERRCODE = 'P0004';
  END IF;

  SELECT id, scheduled_deletion_at INTO existing_id, existing_scheduled
  FROM public.user_deletion_requests
  WHERE user_id = p_user_id AND status = 'pending'
  FOR UPDATE;

  IF existing_id IS NOT NULL THEN
    RETURN QUERY SELECT existing_id, existing_scheduled;
    RETURN;
  END IF;

  INSERT INTO public.user_deletion_requests (
    user_id, reason, ip_address, user_agent, scheduled_deletion_at,
    status, previous_user_status
  ) VALUES (
    p_user_id, p_reason, p_ip_address, p_user_agent, p_scheduled_at,
    'pending', user_status
  )
  RETURNING id INTO existing_id;

  UPDATE public.users
  SET status = 'suspended'
  WHERE id = p_user_id
  RETURNING updated_at INTO suspension_time;

  UPDATE public.user_deletion_requests
  SET suspension_updated_at = suspension_time
  WHERE id = existing_id;

  RETURN QUERY SELECT existing_id, p_scheduled_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion(p_user_id UUID, p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_status TEXT;
  previous_status TEXT;
  suspension_time TIMESTAMPTZ;
  current_status TEXT;
  current_updated_at TIMESTAMPTZ;
BEGIN
  SELECT status, previous_user_status, suspension_updated_at
  INTO request_status, previous_status, suspension_time
  FROM public.user_deletion_requests
  WHERE id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF request_status IS NULL OR request_status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  SELECT status, updated_at INTO current_status, current_updated_at
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF current_status <> 'suspended'
     OR previous_status NOT IN ('active', 'suspended')
     OR suspension_time IS NULL
     OR current_updated_at <> suspension_time THEN
    RETURN FALSE;
  END IF;

  UPDATE public.users
  SET status = previous_status
  WHERE id = p_user_id;

  UPDATE public.user_deletion_requests
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE id = p_request_id;

  RETURN TRUE;
END;
$$;

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

REVOKE EXECUTE ON FUNCTION public.claim_account_deletion(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_account_deletion(UUID, TEXT, INET, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_account_deletion(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_user_deletion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(UUID, TEXT, INET, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_user_deletion(UUID) TO service_role;
