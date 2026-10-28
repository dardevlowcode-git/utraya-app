import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { hashLegalDocument } from '@/lib/legal/hashLegalDocument'
import {
  COOKIE_POLICY_HASH,
  COOKIE_POLICY_VERSION,
  PRIVACY_VISIBLE_HASH,
  PRIVACY_VISIBLE_VERSION,
} from '@/lib/legal/required'

describe('legal privacy and cookie metadata', () => {
  it.each([
    {
      name: 'privacy',
      filePath: 'src/content/legal/legal-privacy.md',
      hash: PRIVACY_VISIBLE_HASH,
      version: PRIVACY_VISIBLE_VERSION,
    },
    {
      name: 'cookie',
      filePath: 'src/content/legal/legal-cookie.md',
      hash: COOKIE_POLICY_HASH,
      version: COOKIE_POLICY_VERSION,
    },
  ])('matches the required hash and version for $name', ({ filePath, hash, version }) => {
    const source = hashLegalDocument(filePath)
    const document = readFileSync(filePath, 'utf8')
    const documentVersion = document.match(/^>\s+\*\*Versione documento\*\*:\s*`([^`]+)`/m)?.[1]

    expect(source).toBe(hash)
    expect(documentVersion).toBe(version)
  })
})
