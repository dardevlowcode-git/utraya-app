/* Commento didattico:
 * Scopo del file: configura i client Supabase per diversi contesti (browser, server o privilegi amministrativi).
 * Moduli richiamati: `@supabase/supabase-js`, `@/lib/types/database`
 * Flusso: I client creati qui vengono importati da servizi/API per eseguire query al database e operazioni di autenticazione.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Admin Supabase client using the service role key.
 * BYPASSES RLS — use ONLY for privileged server-side operations.
 * Never expose this client to the browser.
 *
 * Use cases:
 * - Admin operations (user management, allowlist)
 * - Background job processing
 * - Canonical content management
 * - System-level operations
 */
/**
 * Crea client Supabase con service role per operazioni privilegiate server-side.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
    )
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
