/* Commento didattico:
 * Scopo: protegge i vincoli offline di gate, nuovi video e lease nella migrazione Firecrawl.
 * Flusso: controlla gli oggetti SQL distribuiti senza collegarsi o mutare alcun database.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261012002000_firecrawl_transcript_recovery.sql', import.meta.url),
  'utf8',
)

describe('Firecrawl transcript recovery migration', () => {
  it('semina un gate globale esplicitamente spento e protetto da accesso client', () => {
    expect(migration).toMatch(/firecrawl_transcript_recovery_settings[\s\S]*?enabled BOOLEAN NOT NULL DEFAULT FALSE/i)
    expect(migration).toMatch(/VALUES \(TRUE, FALSE\)[\s\S]*?ON CONFLICT \(id\) DO NOTHING/i)
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.firecrawl_transcript_recovery_settings FROM PUBLIC, anon, authenticated/i)
  })

  it('accoda solo ID video nuovi quando il gate e` esplicitamente acceso', () => {
    expect(migration).toMatch(/new_video_candidates AS MATERIALIZED[\s\S]*?NOT EXISTS \([\s\S]*?FROM public\.videos AS existing/i)
    expect(migration).toMatch(/INSERT INTO public\.channel_scan_firecrawl_transcript_targets[\s\S]*?JOIN new_video_candidates USING \(youtube_video_id\)/i)
    expect(migration).toMatch(/firecrawl_transcript_recovery_settings AS s[\s\S]*?s\.enabled = TRUE/i)
    expect(migration).toMatch(/UNIQUE \(video_id\)/i)
    expect(migration).toMatch(/target\.status IN \('pending', 'fetched', 'missing', 'skipped', 'disabled'\)/i)
  })

  it('riusa lease, cursore e stato budget condivisi con selezione separata per provider', () => {
    expect(migration).toMatch(/CHECK \(provider IN \('youtube', 'firecrawl'\)\)/i)
    expect(migration).toMatch(/PRIMARY KEY \(job_id, provider, credential_id, key_version\)/i)
    expect(migration).toMatch(/CREATE UNIQUE INDEX idx_channel_scan_job_one_active_credential\s+ON public\.channel_scan_job_credentials\(job_id, provider\)\s+WHERE status = 'active'/i)
    expect(migration).toMatch(/claim_channel_scan_provider_request\([\s\S]*?p_provider TEXT/i)
    expect(migration).toMatch(/j\.lease_id = p_lease_id[\s\S]*?FOR UPDATE/i)
    expect(migration).toMatch(/c\.provider = p_provider/i)
  })

  it('fence la scrittura canonica e non inventa segmenti, timestamp o fallback', () => {
    expect(migration).toMatch(/complete_firecrawl_transcript_recovery_target[\s\S]*?j\.lease_id = p_lease_id[\s\S]*?FOR UPDATE/i)
    expect(migration).toMatch(/transcript_status, transcript_text, segments, source, fetched_at, error_details[\s\S]*?'fetched', p_transcript_text, NULL, 'firecrawl-youtube-read'/i)
    expect(migration).toMatch(/'firecrawl_transcript_unavailable'/i)
    expect(migration).toMatch(/transcript_status IN \('fetched', 'legacy_missing'\)/i)
  })
})
