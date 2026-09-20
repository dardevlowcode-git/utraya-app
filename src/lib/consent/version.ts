/* Commento didattico:
 * Scopo del file: espone versione/hash della Cookie Policy per forzare re-consenso al bump documento.
 * Moduli richiamati: `@/lib/legal/required`.
 * Flusso: provider consenso confronta la versione salvata nel cookie con questa costante corrente.
 */

import { COOKIE_POLICY_HASH, COOKIE_POLICY_VERSION } from '@/lib/legal/required'

export { COOKIE_POLICY_VERSION, COOKIE_POLICY_HASH }