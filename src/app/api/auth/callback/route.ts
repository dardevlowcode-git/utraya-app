/* Commento didattico:
 * Scopo del file: gestisce callback OAuth Google con allowlist, provisioning, blocco account in cancellazione e gate TOS.
 * Moduli richiamati: supabase server, allowlist, account deletion, legal acceptance, site URL helper.
 * Flusso: scambia code->session, valida accesso app, esegue provisioning e redirige in modo safe verso dashboard o legal accept.
 */

import { createClient } from '@/lib/supabase/server'
import { provisionNewUser, isEmailAllowlisted } from '@/lib/auth/allowlist'
import { getCurrentUserFromSupabase } from '@/lib/auth/getCurrentUser'
import { getSiteUrl, buildSiteUrl } from '@/lib/env/getSiteUrl'
import { getLegalAcceptanceStatus } from '@/lib/services/legal-acceptance'
import { isDeletionPending } from '@/lib/services/account-deletion'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  let appUrl: URL

  try {
    appUrl = new URL(getSiteUrl())
  } catch {
    return NextResponse.json(
      { data: null, error: 'NEXT_PUBLIC_SITE_URL non valido', errorType: 'structural', errorCode: 'misconfigured_app' },
      { status: 500 }
    )
  }

  const code = searchParams.get('code')
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'
  const safeRedirect = resolveSafeRedirectPath(redirectTo)

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', appUrl))
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(new URL('/login?error=exchange_failed', appUrl))
  }

  const current = await getCurrentUserFromSupabase(supabase)
  if (!current?.user?.email) {
    return NextResponse.redirect(new URL('/login?error=no_user', appUrl))
  }
  const { user } = current
  const userEmail = user.email
  if (!userEmail) {
    return NextResponse.redirect(new URL('/login?error=no_user', appUrl))
  }

  const allowed = await isEmailAllowlisted(userEmail)
  if (!allowed) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=access_denied', appUrl))
  }

  const deletionPending = await isDeletionPending(user.id)
  if (deletionPending) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=deletion_pending', appUrl))
  }

  const identity = user.identities?.[0]
  const provisionResult = await provisionNewUser({
    supabaseUserId: user.id,
    email: userEmail,
    displayName: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatarUrl: user.user_metadata?.avatar_url ?? null,
    provider: identity?.provider ?? 'google',
    providerUserId: identity?.id ?? user.id,
  })

  if (!provisionResult.success) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=exchange_failed', appUrl))
  }

  const acceptanceStatus = await getLegalAcceptanceStatus(user.id)
  if (acceptanceStatus.needsAcceptance) {
    return NextResponse.redirect(new URL(buildSiteUrl('/legal/accept')))
  }

  return NextResponse.redirect(new URL(safeRedirect, appUrl))
}

function resolveSafeRedirectPath(value: string): string {
  let decoded = value.trim()
  try {
    decoded = decodeURIComponent(value).trim()
  } catch {
    return '/dashboard'
  }

  if (!decoded.startsWith('/')) return '/dashboard'
  if (decoded.startsWith('//')) return '/dashboard'
  if (decoded.includes('\\')) return '/dashboard'
  if (decoded.includes('://')) return '/dashboard'

  try {
    const parsed = new URL(decoded, 'https://app.local')
    if (parsed.origin !== 'https://app.local') return '/dashboard'
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/dashboard'
  }
}
