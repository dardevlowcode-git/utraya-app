/* Commento didattico:
 * Scopo: configura ESLint 9 in flat mode con le regole Next.js già adottate dal repository.
 * Moduli richiamati: `eslint-config-next/core-web-vitals` e il plugin TypeScript.
 * Flusso: applica le regole framework e registra il plugin TypeScript senza override o esclusioni ad hoc.
 */

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import typescriptEslintPlugin from '@typescript-eslint/eslint-plugin'

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': typescriptEslintPlugin,
    },
  },
]

export default eslintConfig
