import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

export type AppSupabaseClient = SupabaseClient<Database>
