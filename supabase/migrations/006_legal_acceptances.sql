-- Commento didattico:
-- Scopo del file: aggiunge tracciamento probatorio accettazioni TOS e clausole vessatorie per enforcement legale app-side.
-- Moduli richiamati: schema `public` e tabella `auth.users`.
-- Flusso: registra accettazioni versionate/hashate per utente; RLS consente lettura own/admin, insert via service role.

-- ============================================================
-- Migration 006: legal_acceptances
-- ============================================================

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('tos', 'tos_vexatorious')),
  document_version TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  locale TEXT NOT NULL CHECK (locale IN ('it', 'en')),
  user_email_at_acceptance TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON public.legal_acceptances(user_id);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_kind_version ON public.legal_acceptances(document_kind, document_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_acceptances_unique
  ON public.legal_acceptances(user_id, document_kind, document_version)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Legal acceptances: read own"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Legal acceptances: read admin"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (public.is_super_admin());