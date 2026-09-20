/* Commento didattico:
 * Scopo del file: configura i client Supabase per diversi contesti (browser, server o privilegi amministrativi).
 * Moduli richiamati: `@supabase/ssr`, `@/lib/types/database`
 * Flusso: I client creati qui vengono importati da servizi/API per eseguire query al database e operazioni di autenticazione.
 */

import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Supabase client.
 * Uses the public anon key — subject to RLS policies.
 * Do NOT use this for privileged operations.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
