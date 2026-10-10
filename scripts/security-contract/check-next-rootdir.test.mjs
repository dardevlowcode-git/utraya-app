/* Commento didattico:
 * Scopo: protegge il contratto rootDir del plugin Next tramite la configurazione ESLint effettiva.
 * Flusso: applica config flat reali e verifica che i path letterali passino e i pattern falliscano.
 */

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { ESLint } from 'eslint'
import { checkEffectiveNextRootDirs } from './check-next-rootdir.mjs'

describe('guard della configurazione ESLint effettiva per Next rootDir', () => {
  it('accetta il default attuale e i path letterali relativi, assoluti e array', async () => {
    const currentConfig = new ESLint()
    const relativeLiteralConfig = new ESLint({
      overrideConfig: [{ settings: { next: { rootDir: 'src' } } }],
    })
    const arrayLiteralConfig = new ESLint({
      overrideConfig: [{ settings: { next: { rootDir: [path.resolve('src'), 'src\\app'] } } }],
    })

    await expect(checkEffectiveNextRootDirs(currentConfig, ['eslint.config.mjs'])).resolves.toBe(1)
    await expect(checkEffectiveNextRootDirs(relativeLiteralConfig, ['eslint.config.mjs'])).resolves.toBe(1)
    await expect(checkEffectiveNextRootDirs(arrayLiteralConfig, ['eslint.config.mjs'])).resolves.toBe(1)
  })

  it('rifiuta una rootDir glob dalla configurazione effettiva', async () => {
    const globConfig = new ESLint({
      overrideConfig: [{ settings: { next: { rootDir: '.contract-rootdir-fixture/packages/*' } } }],
    })

    await expect(checkEffectiveNextRootDirs(globConfig, ['eslint.config.mjs'])).rejects.toThrow(
      /rootDir.*glob|glob.*rootDir/i,
    )
  })

  it('rifiuta elementi non stringa nelle rootDir array', async () => {
    const malformedConfig = new ESLint({
      overrideConfig: [{ settings: { next: { rootDir: ['src', { path: 'packages/web' }] } } }],
    })

    await expect(checkEffectiveNextRootDirs(malformedConfig, ['eslint.config.mjs'])).rejects.toThrow(
      /rootDir.*string|string.*rootDir/i,
    )
  })
})
