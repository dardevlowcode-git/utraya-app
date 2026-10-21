-- Commento didattico:
-- Scopo del file: conserva lo stato utente precedente alla richiesta di cancellazione
-- e il timestamp della sospensione applicata dal flusso, evitando riattivazioni
-- indebite dopo una modifica amministrativa concorrente.

ALTER TABLE public.user_deletion_requests
  ADD COLUMN IF NOT EXISTS previous_user_status TEXT NOT NULL DEFAULT 'active'
    CHECK (previous_user_status IN ('active', 'suspended', 'deleted')),
  ADD COLUMN IF NOT EXISTS suspension_updated_at TIMESTAMPTZ;

-- Le richieste gia` esistenti non hanno un marker affidabile della sospensione.
-- In caso ambiguo si conserva lo stato attuale (fail-safe: mai riattivare).
UPDATE public.user_deletion_requests AS requests
SET previous_user_status = users.status,
    suspension_updated_at = CASE WHEN users.status = 'suspended' THEN users.updated_at ELSE NULL END
FROM public.users AS users
WHERE requests.user_id = users.id
  AND requests.status = 'pending';
