/* Commento didattico:
 * Scopo del file: gestisce regole e utilita` legate ad autenticazione, permessi e controlli di accesso.
 * Moduli richiamati: `@/lib/supabase/admin`
 * Flusso: Queste funzioni vengono usate da middleware, layout o API per decidere se un utente puo` accedere a una risorsa.
 */

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Logica allowlist (lista email autorizzate).
 *
 * Un utente puo entrare in Utraya solo se:
 * 1. completa login OAuth (gestito da Supabase),
 * 2. la sua email risulta attiva in `allowlist_entries`.
 *
 * Scelta intenzionale V1: niente auto-registrazione.
 */

/**
 * Verifica se una email e autorizzata.
 * Usa client admin per bypassare RLS: controllo sicurezza centralizzato.
 */
export async function isEmailAllowlisted(email: string): Promise<boolean> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('allowlist_entries')
    .select('id, is_active')
    .eq('email', email.toLowerCase().trim())
    .eq('is_active', true)
    .single()

  if (error || !data) return false
  return data.is_active
}

/**
 * Abilita una email in allowlist.
 * Chiamata indirettamente dalle API admin (`api/admin/allowlist/route.ts`).
 */
export async function addToAllowlist(
  email: string,
  addedByAdminId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient()

  const { error } = await supabase.from('allowlist_entries').upsert(
    {
      email: email.toLowerCase().trim(),
      added_by: addedByAdminId,
      is_active: true,
    },
    { onConflict: 'email' }
  )

  if (error) return { success: false, error: error.message }
  return { success: true }
}

/**
 * Revoca accesso disattivando l'email.
 * Da quel momento il middleware blocca nuove sessioni applicative.
 */
export async function removeFromAllowlist(email: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('allowlist_entries')
    .update({ is_active: false })
    .eq('email', email.toLowerCase().trim())

  if (error) return { success: false, error: error.message }
  return { success: true }
}

/**
 * Provisioning utente al primo login riuscito.
 * Invocata dal callback OAuth (`api/auth/callback/route.ts`).
 *
 * Cosa crea:
 * - record in `users`,
 * - identita provider in `user_identities`,
 * - ruolo base in `user_roles`,
 * - watchlist di default.
 */
export async function provisionNewUser(params: {
  supabaseUserId: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  provider: string
  providerUserId: string
}): Promise<{ success: boolean; userId?: string; error?: string }> {
  const supabase = createAdminClient()

  // Upsert idempotente: evita duplicati se callback viene richiamato piu volte.
  const { data: user, error: userError } = await supabase
    .from('users')
    .upsert(
      {
        id: params.supabaseUserId,
        email: params.email.toLowerCase().trim(),
        display_name: params.displayName,
        avatar_url: params.avatarUrl,
        preferred_language: 'it',
        status: 'active',
      },
      { onConflict: 'id' }
    )
    .select('id')
    .single()

  if (userError || !user) {
    return { success: false, error: userError?.message ?? 'Failed to create user' }
  }

  // Collega l'utente interno all'identita del provider OAuth.
  await supabase.from('user_identities').upsert(
    {
      user_id: user.id,
      provider: params.provider,
      provider_user_id: params.providerUserId,
      email: params.email.toLowerCase().trim(),
    },
    { onConflict: 'user_id,provider' }
  )

  // Assegna il ruolo base `user` per autorizzazioni applicative.
  const { data: userRole } = await supabase
    .from('roles')
    .select('id')
    .eq('name', 'user')
    .single()

  if (userRole) {
    await supabase.from('user_roles').upsert(
      { user_id: user.id, role_id: userRole.id },
      { onConflict: 'user_id,role_id' }
    )
  }

  // Crea watchlist iniziale per rendere subito utilizzabile la UI privata.
  await supabase.from('watchlists').upsert(
    { user_id: user.id, name: 'Da vedere', is_default: true },
    { onConflict: 'user_id,is_default' }
  )

  return { success: true, userId: user.id }
}
