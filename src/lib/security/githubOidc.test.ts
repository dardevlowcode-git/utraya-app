/* Commento didattico:
 * Scopo del file: verifica la validazione OIDC GitHub senza rete, con chiavi RSA reali e JWKS mockato.
 * Moduli richiamati: `../githubOidc`, `node:crypto`, `vitest`.
 * Flusso: firma token di prova, espone la JWK via fetch mock e controlla accept/reject dei claim.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { verifyGitHubActionsOidc } from './githubOidc'

const ISSUER = 'https://token.actions.githubusercontent.com'
const AUDIENCE = 'https://github.com/dardevlowcode-git/utraya-app'
const REPOSITORY = 'dardevlowcode-git/utraya-app'
const WORKFLOW = `${REPOSITORY}/.github/workflows/api-verifier.yml`
const KID = 'test-key-1'

let privateKey: ReturnType<typeof createPrivateKey>
let publicJwk: Record<string, unknown>

function b64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signOidc(claims: Record<string, unknown>, kid = KID): string {
  const header = b64url({ alg: 'RS256', kid, typ: 'JWT' })
  const payload = b64url(claims)
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function claimsForBranch(branch: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    repository: REPOSITORY,
    workflow_ref: `${WORKFLOW}@refs/heads/${branch}`,
    ref: `refs/heads/${branch}`,
    event_name: 'workflow_dispatch',
    jti: 'jti-test-1',
    exp: now + 300,
    nbf: now - 10,
    ...overrides,
  }
}

describe('verifyGitHubActionsOidc', () => {
  beforeAll(() => {
    const { publicKey, privateKey: generated } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    privateKey = generated
    publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [publicJwk] }),
    }))
    vi.unstubAllEnvs()
  })

  it('accetta un token preprod valido e restituisce jti/exp', async () => {
    const claims = claimsForBranch('preprod')
    const result = await verifyGitHubActionsOidc(signOidc(claims), 'preview')
    expect(result).toMatchObject({ jti: 'jti-test-1', exp: claims.exp })
  })

  it.each([
    { target: 'dev', branch: 'dev' },
    { target: 'preview', branch: 'preprod' },
    { target: 'production', branch: 'main' },
  ] as const)('accetta il mapping target $target → refs/heads/$branch', async ({ target, branch }) => {
    await expect(verifyGitHubActionsOidc(signOidc(claimsForBranch(branch)), target)).resolves.toMatchObject({ jti: 'jti-test-1' })
  })

  it.each([
    { target: 'dev', branch: 'preprod' },
    { target: 'preview', branch: 'dev' },
    { target: 'production', branch: 'preprod' },
  ] as const)('rifiuta il mapping non autorizzato target $target con ref $branch', async ({ target, branch }) => {
    await expect(verifyGitHubActionsOidc(signOidc(claimsForBranch(branch)), target)).rejects.toThrow('OIDC claims non autorizzati')
  })

  it('rifiuta i token oltre la tolleranza di scadenza', async () => {
    const now = Math.floor(Date.now() / 1000)
    await expect(verifyGitHubActionsOidc(signOidc(claimsForBranch('preprod', { exp: now - 120 })), 'preview')).rejects.toThrow('OIDC claims non autorizzati')
  })

  it('rifiuta la firma manomessa', async () => {
    const token = signOidc(claimsForBranch('preprod'))
    const [header, payload, signature] = token.split('.')
    const tampered = `${header}.${payload}.${signature.slice(0, -2)}aa`
    await expect(verifyGitHubActionsOidc(tampered, 'preview')).rejects.toThrow('OIDC firma non valida')
  })

  it('rifiuta gli eventi diversi da workflow_dispatch', async () => {
    await expect(verifyGitHubActionsOidc(signOidc(claimsForBranch('preprod', { event_name: 'push' })), 'preview')).rejects.toThrow('OIDC claims non autorizzati')
  })
})
