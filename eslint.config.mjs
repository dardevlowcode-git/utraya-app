/* Commento didattico:
 * Scopo: configura ESLint in flat mode con le regole Next.js già adottate dal repository.
 * Modulo richiamato: `eslint-config-next/core-web-vitals`, che registra anche il plugin TypeScript per i file TS.
 * Flusso: applica la config del framework senza registrare di nuovo il plugin TypeScript e creare conflitti.
 */

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [{ ignores: ['src/lib/types/database.generated.ts'] }, ...nextCoreWebVitals]

export default eslintConfig
