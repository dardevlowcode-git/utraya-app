/* Commento didattico:
 * Scopo del file: gestisce regole e utilita` legate ad autenticazione, permessi e controlli di accesso.
 * Moduli richiamati: `@/lib/supabase/server`, `@/lib/types/domain`
 * Flusso: Queste funzioni vengono usate da middleware, layout o API per decidere se un utente puo` accedere a una risorsa.
 */

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/getCurrentUser'
import type { AuthSession } from '@/lib/types/domain'

/**
 * Strato di astrazione autenticazione.
 * Tutta la logica auth passa da qui, cosi le pagine usano un'interfaccia unica.
 * In futuro si possono aggiungere provider (es. Microsoft) senza riscrivere
 * dashboard/API che oggi chiamano queste funzioni.
 *
 * V1: Supabase Auth con Google OAuth.
 */

/**
 * Restituisce la sessione applicativa completa (profilo + ruolo).
 * Torna `null` se l'utente non e autenticato o non e pronto lato app.
 *
 * Flusso:
 * 1. Legge utente autenticato da Supabase Auth.
 * 2. Carica profilo interno da tabella `users`.
 * 3. Deriva il ruolo da `user_roles -> roles`.
 */
export async function getCurrentSession(): Promise<AuthSession | null> {
  const current = await getCurrentUser()
  if (!current || !current.user.email) return null
  const { supabase, user } = current

  // Query esplicita sulla FK `user_roles_user_id_fkey`:
  // evita ambiguita quando esistono piu relazioni verso `user_roles`.
  const { data: userProfile } = await supabase
    .from('users')
    .select('*, user_roles!user_roles_user_id_fkey(role_id, roles(name))')
    .eq('id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!userProfile) return null

  // Calcolo ruolo applicativo semplificato per UI/API.
  // Se non c'e `super_admin`, l'utente viene trattato come `user`.
  const userRoles = userProfile.user_roles as Array<{ roles: { name: string } }> | null
  const isSuperAdmin = userRoles?.some((ur) => ur.roles?.name === 'super_admin') ?? false

  return {
    userId: userProfile.id,
    email: userProfile.email,
    displayName: userProfile.display_name,
    avatarUrl: userProfile.avatar_url,
    role: isSuperAdmin ? 'super_admin' : 'user',
    preferredLanguage: userProfile.preferred_language ?? 'it',
  }
}

/**
 * Variante leggera: verifica solo autenticazione Supabase.
 * Utile quando non servono ruolo/preferenze.
 */
export async function getAuthUser() {
  const current = await getCurrentUser()
  return current?.user ?? null
}

/**
 * Logout utente standard (sessione Supabase).
 */
export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

/**
 * Costruisce l'URL locale che avvia OAuth Google tramite endpoint server.
 * L'endpoint poi delega a Supabase la parte OAuth reale.
 */
export function getGoogleSignInUrl(redirectTo: string): string {
  // Chiamato dal client (pagina login), ma il flusso finale passa da API route.
  return `/api/auth/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`
}
