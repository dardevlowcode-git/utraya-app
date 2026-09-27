/* Commento didattico:
 * Scopo: verifica la richiesta Gemini del probe DEV senza rete o credenziali reali.
 * Moduli richiamati: service Gemini probe e mock fetch di Vitest.
 * Flusso: controlla modello/limiti fissi, assenza di retry e non esposizione della chiave nel risultato.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { runGeminiVercelProbe } from './gemini-probe'

describe('runGeminiVercelProbe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends one fixed 3.5 request and never returns the API key', async () => {
    const apiKey = 'probe-test-key-never-return-this'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: '[00:00] Introduzione. [01:10] Conclusione.' }] }],
      usage: { total_input_tokens: 100, total_output_tokens: 20, total_tokens: 120 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runGeminiVercelProbe(apiKey)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body)) as { model: string; store: boolean; generation_config: { max_output_tokens: number }; input: Array<{ type: string; uri?: string }> }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body.model).toBe('gemini-3.5-flash-lite')
    expect(body.store).toBe(false)
    expect(body.generation_config.max_output_tokens).toBe(400)
    expect(body.input.find((part) => part.type === 'video')?.uri).toBe('https://www.youtube.com/watch?v=9hE5-98ZeCg')
    expect(result).toMatchObject({ ok: true, timestampCount: 2, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } })
    expect(JSON.stringify(result)).not.toContain(apiKey)
  })

  it('does not retry a provider quota response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runGeminiVercelProbe('probe-test-key')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, httpStatus: 429, providerErrorCode: 'RESOURCE_EXHAUSTED' })
  })
})
