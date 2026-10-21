/* Commento didattico:
 * Scopo del file: espone l'entrypoint auth server-side unico per ottenere utente corrente e client Supabase.
 * Moduli richiamati: `@/lib/supabase/server`.
 * Flusso: route/server component invoca questa funzione per autenticazione senza duplicare chiamate auth sparse.
 */

import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

type CurrentUserContext = {
  user: User
  supabase: ServerSupabaseClient
}

export async function getCurrentUserFromSupabase(supabase: ServerSupabaseClient): Promise<CurrentUserContext | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user?.id || !user.email) {
    return null
  }

  return {
    user,
    supabase,
  }
}

async function getActiveCurrentUserFromSupabase(supabase: ServerSupabaseClient): Promise<CurrentUserContext | null> {
  const current = await getCurrentUserFromSupabase(supabase)
  if (!current) return null

  const { data: appUser, error } = await supabase
    .from('users')
    .select('id')
    .eq('id', current.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (error || !appUser) return null

  return current
}

export async function getCurrentUser(): Promise<CurrentUserContext | null> {
  const supabase = await createClient()
  return getActiveCurrentUserFromSupabase(supabase)
}
