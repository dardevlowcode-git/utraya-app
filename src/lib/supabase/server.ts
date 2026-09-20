/* Commento didattico:
 * Scopo del file: configura i client Supabase per diversi contesti (browser, server o privilegi amministrativi).
 * Moduli richiamati: `@supabase/ssr`, `next/headers`, `@/lib/types/database`
 * Flusso: I client creati qui vengono importati da servizi/API per eseguire query al database e operazioni di autenticazione.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client.
 * Uses session cookies — runs under the authenticated user's permissions.
 * Use this in Server Components, Server Actions, and Route Handlers
 * where you need to respect the currently authenticated user's session.
 */
/**
 * Crea client Supabase server-side legato ai cookie della richiesta corrente.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method is called from Server Components, which
            // cannot set cookies directly. This is expected in cases where
            // the session refresh is handled by middleware.
          }
        },
      },
    }
  )
}
