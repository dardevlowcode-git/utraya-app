import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import AdminUsersClient from './AdminUsersClient'

export const metadata: Metadata = { title: 'Admin — Utenti' }

export default async function AdminUsersPage() {
  const supabase = createAdminClient()
  let schemaError: string | null = null

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select(`
      *,
      user_roles!user_roles_user_id_fkey(role_id, roles(name))
    `)
    .order('created_at', { ascending: false })

  const { data: allowlist, error: allowlistError } = await supabase
    .from('allowlist_entries')
    .select('*')
    .order('added_at', { ascending: false })

  if (usersError || allowlistError) {
    const message = usersError?.message ?? allowlistError?.message ?? ''
    schemaError = message.includes('schema cache')
      ? 'Schema DB non inizializzato su Supabase: applica prima le migrazioni in supabase/migrations.'
      : message
  }

  return (
    <AdminUsersClient
      initialUsers={users ?? []}
      initialAllowlist={allowlist ?? []}
      schemaError={schemaError}
    />
  )
}
