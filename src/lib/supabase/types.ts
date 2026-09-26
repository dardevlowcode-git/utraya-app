/* Commento didattico:
 * Scopo del file: definisce il tipo comune del client Supabase server-side usato da cookie e Bearer API.
 * Moduli richiamati: `@supabase/supabase-js`, `@/lib/types/database`.
 * Flusso: i service ricevono questo client opzionale per riusare la stessa logica con sessione web o token mobile.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

export type AppSupabaseClient = SupabaseClient<Database>
