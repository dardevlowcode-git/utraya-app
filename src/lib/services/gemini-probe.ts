/* Commento didattico:
 * Scopo: prova usa-e-getta di una richiesta Gemini video URL dal runtime Node Vercel.
 * Moduli richiamati: client admin DEV e getter credenziale Utraya server-side; fetch nativo.
 * Flusso: autorizza un account DEV fisso via env sensibile, recupera la chiave cifrata in memoria e invia il video pubblico senza persistenza o logging.
 */

import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'

export const GEMINI_PROBE_MODEL = 'gemini-3.5-flash-lite'
const VIDEO_URL = 'https://www.youtube.com/watch?v=9hE5-98ZeCg'
const TOKEN_ENV = 'GEMINI_PROBE_TOKEN_20260928_0017'
const USER_EMAIL_ENV = 'GEMINI_PROBE_USER_EMAIL_20260928_0017'
const TEMPORARY_TOKEN_PATTERN = /^(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})$/
const MAX_TOKEN_LIFETIME_SECONDS = 300
let probeClaimedInThisRuntime = false

type InteractionResponse = {
  error?: {
    code?: number | string
    status?: string
  }
  status?: string
  steps?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  usage?: {
    total_input_tokens?: number
    total_output_tokens?: number
    total_tokens?: number
  }
}

export function isGeminiProbeDevDeployment(): boolean {
  return process.env.VERCEL_ENV === 'production' && process.env.VERCEL_GIT_COMMIT_REF === 'dev'
}

export function isGeminiProbeAuthorized(request: Request): boolean {
  const expected = process.env[TOKEN_ENV]
  const received = request.headers.get('authorization') ?? ''
  if (!expected) return false

  const tokenMatch = TEMPORARY_TOKEN_PATTERN.exec(expected)
  if (!tokenMatch) return false
  const expiresAtSeconds = Number(tokenMatch[1])
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= nowSeconds) return false
  if (expiresAtSeconds > nowSeconds + MAX_TOKEN_LIFETIME_SECONDS) return false

  const expectedBuffer = Buffer.from(`Bearer ${expected}`, 'utf8')
  const receivedBuffer = Buffer.from(received, 'utf8')
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

async function getAuthorizedProfileApiKey(): Promise<string | null> {
  const email = process.env[USER_EMAIL_ENV]?.trim().toLowerCase()
  if (!email) return null

  const admin = createAdminClient()
  const { data: user, error } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !user?.id) return null
  return getProviderApiKeyForUserAsAdmin(user.id, 'gemini')
}

export function claimGeminiProbeInThisRuntime(): boolean {
  if (probeClaimedInThisRuntime) return false
  probeClaimedInThisRuntime = true
  return true
}

export async function runGeminiVercelProbe(apiKey: string) {
  const startedAt = Date.now()
  // Probe monouso: nessun retry, per rispettare il limite della singola chiamata autorizzata.
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: GEMINI_PROBE_MODEL,
      store: false,
      input: [
        {
          type: 'text',
          text: 'Fornisci un riassunto conciso e cronologico in italiano. Usa al massimo due capitoli con timestamp [MM:SS], parafrasa fedelmente le idee principali, senza citazioni estese e senza aggiungere fatti. Se i timestamp non sono determinabili, non inventarli.',
        },
        { type: 'video', uri: VIDEO_URL },
      ],
      generation_config: { max_output_tokens: 400 },
    }),
  })

  const body = await response.json().catch(() => null) as InteractionResponse | null
  if (!response.ok || !body) {
    return {
      ok: false as const,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      providerStatus: body?.status ?? null,
      providerErrorCode: body?.error?.status ?? body?.error?.code ?? null,
    }
  }

  const summary = (body.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')

  return {
    ok: body.status === 'completed' && summary.trim().length > 0,
    httpStatus: response.status,
    model: GEMINI_PROBE_MODEL,
    videoId: '9hE5-98ZeCg',
    durationMs: Date.now() - startedAt,
    providerStatus: body.status ?? null,
    timestampCount: (summary.match(/\[\d{1,2}:\d{2}\]/g) ?? []).length,
    summary,
    usage: body.usage
      ? {
          inputTokens: body.usage.total_input_tokens ?? null,
          outputTokens: body.usage.total_output_tokens ?? null,
          totalTokens: body.usage.total_tokens ?? null,
        }
      : null,
  }
}

export async function executeGeminiProfileProbe() {
  let apiKey = ''
  try {
    apiKey = await getAuthorizedProfileApiKey() ?? ''
    if (!apiKey) return { ok: false as const, failure: 'profile_unavailable' as const }
    return await runGeminiVercelProbe(apiKey)
  } catch {
    return { ok: false as const, failure: 'probe_failed' as const }
  } finally {
    apiKey = ''
  }
}
