/* Commento didattico:
 * Scopo del file: rende monouso il jti OIDC del workflow API verifier tramite una tabella server-side.
 * Moduli richiamati: `@/lib/supabase/admin`, `@/lib/utils/errors`.
 * Flusso: elimina nonce scaduti, inserisce il jti con vincolo primario e rifiuta replay concorrenti.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { AppError } from '@/lib/utils/errors'

export async function consumeGitHubOidcJti(jti: string, expiresAt: number): Promise<void> {
  const admin = createAdminClient()
  await admin.from('api_verifier_oidc_nonces').delete().lt('expires_at', new Date().toISOString())
  const { error } = await admin.from('api_verifier_oidc_nonces').insert({
    jti,
    // Mantieni il nonce per tutta la tolleranza temporale usata dal verifier
    // OIDC: un token consumato appena prima della scadenza non deve poter
    // essere riutilizzato dopo che il cleanup ha eliminato la sua riga.
    expires_at: new Date((expiresAt + 60) * 1000).toISOString(),
  })
  if (error?.code === '23505') throw new AppError('OIDC token già utilizzato', 'unauthorized', 401)
  if (error) throw new AppError('Impossibile registrare nonce OIDC', 'unknown', 500, { cause: error.message })
}
