-- Commento didattico:
-- Scopo del file: definisce baseline RLS consolidata per tutte le tabelle applicative.
-- Moduli richiamati: schema `public` Supabase/Postgres, funzione helper `is_super_admin()`.
-- Flusso: abilita RLS e crea policy granulari per utenti autenticati e ruoli admin.

-- Consolidated RLS baseline for a fresh environment.
-- Includes the final behavior previously split across migrations 005..010.

-- Enable RLS on all tables
ALTER TABLE public.roles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_identities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowlist_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions_audit       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_checks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_analysis            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_analysis_raw        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_localized_content   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_sync_state      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_channels             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_channel_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_video_states         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlists                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_attempts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_locks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_logs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents                 ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = (select auth.uid())
      AND r.name = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- USERS
CREATE POLICY "Users: read own" ON public.users
  FOR SELECT TO authenticated
  USING (id = (select auth.uid()) OR public.is_super_admin());

CREATE POLICY "Users: update own" ON public.users
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- USER IDENTITIES
CREATE POLICY "User identities: read own" ON public.user_identities
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_super_admin());

-- USER ROLES
CREATE POLICY "User roles: read own" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_super_admin());

-- ROLES
CREATE POLICY "Roles: authenticated read" ON public.roles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

-- ALLOWLIST / ADMIN AUDIT
CREATE POLICY "Allowlist: admin only" ON public.allowlist_entries
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Admin audit: admin only" ON public.admin_actions_audit
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- USER PROVIDER CREDENTIALS
CREATE POLICY "Credentials: read own" ON public.user_provider_credentials
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_super_admin());

CREATE POLICY "Credentials: insert own" ON public.user_provider_credentials
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Credentials: update own" ON public.user_provider_credentials
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Credentials: delete own" ON public.user_provider_credentials
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Credential checks: read own" ON public.credential_checks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_provider_credentials c
      WHERE c.id = credential_id
        AND (c.user_id = (select auth.uid()) OR public.is_super_admin())
    )
  );

-- CANONICAL CONTENT
CREATE POLICY "Channels: authenticated read" ON public.channels
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

CREATE POLICY "Channels: admin insert" ON public.channels
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Channels: admin update" ON public.channels
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Channels: admin delete" ON public.channels
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Videos: authenticated read" ON public.videos
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

CREATE POLICY "Videos: admin insert" ON public.videos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Videos: admin update" ON public.videos
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Videos: admin delete" ON public.videos
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Video analysis: authenticated read" ON public.video_analysis
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

CREATE POLICY "Video analysis: admin insert" ON public.video_analysis
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Video analysis: admin update" ON public.video_analysis
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Video analysis: admin delete" ON public.video_analysis
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Video analysis raw: admin only" ON public.video_analysis_raw
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Localized content: authenticated read" ON public.video_localized_content
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

CREATE POLICY "Localized content: admin insert" ON public.video_localized_content
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Localized content: admin update" ON public.video_localized_content
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Localized content: admin delete" ON public.video_localized_content
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Sync state: authenticated read" ON public.canonical_sync_state
  FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

-- USER LAYER
CREATE POLICY "User channels: own" ON public.user_channels
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_super_admin())
  WITH CHECK (user_id = (select auth.uid()) OR public.is_super_admin());

CREATE POLICY "User channel prefs: own" ON public.user_channel_preferences
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_channels uc
      WHERE uc.id = user_channel_id
        AND (uc.user_id = (select auth.uid()) OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_channels uc
      WHERE uc.id = user_channel_id
        AND (uc.user_id = (select auth.uid()) OR public.is_super_admin())
    )
  );

CREATE POLICY "User video states: own" ON public.user_video_states
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_super_admin())
  WITH CHECK (user_id = (select auth.uid()) OR public.is_super_admin());

CREATE POLICY "Watchlists: own" ON public.watchlists
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_super_admin())
  WITH CHECK (user_id = (select auth.uid()) OR public.is_super_admin());

CREATE POLICY "Watchlist items: own" ON public.watchlist_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.watchlists w
      WHERE w.id = watchlist_id
        AND (w.user_id = (select auth.uid()) OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.watchlists w
      WHERE w.id = watchlist_id
        AND (w.user_id = (select auth.uid()) OR public.is_super_admin())
    )
  );

-- JOBS & OPERATIONS
CREATE POLICY "Jobs: read own or admin" ON public.jobs
  FOR SELECT TO authenticated
  USING (created_by_user_id = (select auth.uid()) OR public.is_super_admin());

CREATE POLICY "Jobs: admin insert" ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Jobs: admin update" ON public.jobs
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Jobs: admin delete" ON public.jobs
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Job attempts: admin only" ON public.job_attempts
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Job locks: admin only" ON public.job_locks
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "App logs: admin only" ON public.app_logs
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Audit logs: admin only" ON public.audit_logs
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Incidents: admin only" ON public.incidents
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
