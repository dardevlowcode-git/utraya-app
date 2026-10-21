/* Commento didattico:
 * Scopo del file: autentica esclusivamente token Supabase Bearer per la superficie API versionata.
 * Moduli richiamati: `@supabase/supabase-js`, `@/lib/supabase/types`, `@/lib/types/database`.
 * Flusso: estrae Authorization, valida il JWT presso Supabase e restituisce user + client con header Bearer.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'
import type { AppSupabaseClient } from '@/lib/supabase/types'
import { isEmailAllowlisted } from '@/lib/auth/allowlist'
import { createAdminClient } from '@/lib/supabase/admin'

export type ApiUserContext = {
  user: User
  supabase: AppSupabaseClient
}

function getBearerToken(request: Request): string | null {
  const value = request.headers.get('authorization')?.trim() ?? ''
  const match = /^Bearer\s+([^\s]+)$/i.exec(value)
  if (!match || match[1].length > 4096) return null
  return match[1]
}

function createBearerClient(token: string): AppSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) {
    throw new Error('Configurazione Supabase incompleta')
  }

  return createSupabaseClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  })
}

export async function getApiUser(request: Request): Promise<ApiUserContext | null> {
  const token = getBearerToken(request)
  if (!token) return null

  const supabase = createBearerClient(token)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  if (error || !user?.id || !user.email) return null

  // La superficie API bypassa il middleware cookie: replica quindi allowlist e stato applicativo qui.
  if (!(await isEmailAllowlisted(user.email))) return null
  const admin = createAdminClient()
  const { data: appUser } = await admin
    .from('users')
    .select('id')
    .eq('id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!appUser) return null

  return { user, supabase }
}
