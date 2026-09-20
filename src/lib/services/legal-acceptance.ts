/* Commento didattico:
 * Scopo del file: implementa logica server-side per verificare e registrare accettazioni TOS/clausole vessatorie.
 * Moduli richiamati: `@/lib/supabase/admin`, `@/lib/legal/required`, `@/lib/view-models/legalAcceptance`.
 * Flusso: layout/callback usano lo status; route `/api/legal/accept` invoca registrazione accettazioni.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  PRIVACY_VISIBLE_HASH,
  PRIVACY_VISIBLE_VERSION,
  TOS_REQUIRED_HASH,
  TOS_REQUIRED_VERSION,
  TOS_VEX_REQUIRED_HASH,
  TOS_VEX_REQUIRED_VERSION,
} from '@/lib/legal/required'
import type { LegalAcceptanceKind, LegalAcceptanceView } from '@/lib/view-models/legalAcceptance'

function requiredByKind(kind: LegalAcceptanceKind): { version: string; hash: string } {
  if (kind === 'tos') {
    return { version: TOS_REQUIRED_VERSION, hash: TOS_REQUIRED_HASH }
  }
  return { version: TOS_VEX_REQUIRED_VERSION, hash: TOS_VEX_REQUIRED_HASH }
}

export async function getLegalAcceptanceStatus(userId: string, locale: 'it' | 'en' = 'it'): Promise<LegalAcceptanceView> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('legal_acceptances')
    .select('document_kind, document_version')
    .eq('user_id', userId)
    .in('document_kind', ['tos', 'tos_vexatorious'])

  if (error) {
    throw new Error(`Errore lettura legal_acceptances: ${error.message}`)
  }

  const accepted = new Set((data ?? []).map((row) => `${row.document_kind}:${row.document_version}`))
  const missing: LegalAcceptanceKind[] = []

  if (!accepted.has(`tos:${TOS_REQUIRED_VERSION}`)) {
    missing.push('tos')
  }

  if (!accepted.has(`tos_vexatorious:${TOS_VEX_REQUIRED_VERSION}`)) {
    missing.push('tos_vexatorious')
  }

  return {
    needsAcceptance: missing.length > 0,
    missing,
    tosVersion: TOS_REQUIRED_VERSION,
    tosHash: TOS_REQUIRED_HASH,
    tosVexVersion: TOS_VEX_REQUIRED_VERSION,
    tosVexHash: TOS_VEX_REQUIRED_HASH,
    privacyVersion: PRIVACY_VISIBLE_VERSION,
    privacyHash: PRIVACY_VISIBLE_HASH,
    currentLocale: locale,
  }
}

export async function recordLegalAcceptance(params: {
  userId: string
  userEmail: string
  kinds: LegalAcceptanceKind[]
  ipAddress: string | null
  userAgent: string | null
  locale: 'it' | 'en'
}): Promise<void> {
  const supabase = createAdminClient()
  const rows = params.kinds.map((kind) => {
    const required = requiredByKind(kind)
    return {
      user_id: params.userId,
      document_kind: kind,
      document_version: required.version,
      document_hash: required.hash,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
      locale: params.locale,
      user_email_at_acceptance: params.userEmail,
    }
  })

  const { error } = await supabase.from('legal_acceptances').insert(rows)
  if (error && !error.message.includes('duplicate key value')) {
    throw new Error(`Errore insert legal_acceptances: ${error.message}`)
  }
}