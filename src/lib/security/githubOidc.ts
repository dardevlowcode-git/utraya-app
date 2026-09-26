/* Commento didattico:
 * Scopo del file: verifica token OIDC GitHub Actions per il broker interno del verificatore, senza secret statici.
 * Moduli richiamati: `node:crypto` e fetch JWKS GitHub.
 * Flusso: valida firma RS256, issuer/audience, repository, workflow e branch prima di autorizzare il broker.
 */

import { createPublicKey, verify } from 'node:crypto'

const issuer = 'https://token.actions.githubusercontent.com'
const audience = 'https://github.com/dardevlowcode-git/utraya-app'
const repository = 'dardevlowcode-git/utraya-app'
const workflow = `${repository}/.github/workflows/api-verifier.yml`
let jwksCache: { expiresAt: number; keys: Array<Record<string, unknown>> } | null = null

export type GitHubOidcClaims = { jti: string; exp: number }

function decodePart(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
}

async function getSigningKeys(): Promise<Array<Record<string, unknown>>> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys
  const response = await fetch(`${issuer}/.well-known/jwks`, { signal: AbortSignal.timeout(5_000), cache: 'no-store' })
  if (!response.ok) throw new Error('GitHub OIDC JWKS non disponibile')
  const body = await response.json() as { keys?: Array<Record<string, unknown>> }
  const keys = body.keys ?? []
  jwksCache = { keys, expiresAt: Date.now() + 10 * 60 * 1000 }
  return keys
}

export async function verifyGitHubActionsOidc(token: string, target: 'preview' | 'production'): Promise<GitHubOidcClaims> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('OIDC token malformato')
  const header = decodePart(parts[0])
  const claims = decodePart(parts[1])
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('OIDC algoritmo non consentito')

  const key = (await getSigningKeys()).find((candidate) => candidate.kid === header.kid)
  if (!key) throw new Error('OIDC signing key non riconosciuta')
  const publicKey = createPublicKey({ key: key as JsonWebKey, format: 'jwk' })
  const validSignature = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))
  if (!validSignature) throw new Error('OIDC firma non valida')

  const now = Math.floor(Date.now() / 1000)
  const expectedBranch = target === 'production' ? 'main' : 'preprod'
  const workflowRef = `${workflow}@refs/heads/${expectedBranch}`
  const tokenAudience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (
    claims.iss !== issuer
    || !tokenAudience.includes(audience)
    || claims.repository !== repository
    || claims.workflow_ref !== workflowRef
    || claims.ref !== `refs/heads/${expectedBranch}`
    || claims.event_name !== 'workflow_dispatch'
    || typeof claims.jti !== 'string'
    || typeof claims.exp !== 'number'
    || claims.exp < now - 60
    || (typeof claims.nbf === 'number' && claims.nbf > now + 60)
  ) {
    throw new Error('OIDC claims non autorizzati')
  }

  return { jti: claims.jti, exp: claims.exp as number }
}
