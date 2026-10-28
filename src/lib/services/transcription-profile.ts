import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAndRecordProviderRequest } from '@/lib/services/api-usage'
import { getProviderApiKeyForUserAsAdmin } from '@/lib/services/integrations'
import { GEMINI_API_BASE_URL, type ThinkingLevel } from '@/lib/services/transcription'

type AdminClient = ReturnType<typeof createAdminClient>

export const MODELS_LIST_OPERATION = 'models.list'
export const GEMINI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'
export const PRICE_MAX = 999_999.999999
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

const MODELS_TIMEOUT_MS = 10_000
const MODELS_PAGE_SIZE = 1000
const MODELS_MAX_PAGES = 5
const MAX_KEYS_TRIED = 5
const ALL_LEVELS: readonly ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']
const EXCLUDED_MODEL_PARTS = /(tts|image|embedding|live|native-audio|lyria|deep-research|nano-banana|robotics|computer-use|aqa|veo|imagen)/i

export interface TranscriptionProfileSettings {
  model: string
  thinkingLevel: ThinkingLevel
  inputPricePerMillion: number
  outputPricePerMillion: number
}

export type ModelsListResult =
  | { status: 'ok'; models: string[] }
  | { status: 'no_key' }
  | { status: 'error' }

/** Famiglia di ragionamento: budget di token per la serie 2.5, livello per le altre. */
export function getThinkingFamily(model: string): 'budget' | 'level' {
  return model.startsWith('gemini-2.5') ? 'budget' : 'level'
}

/** Livelli validi per la famiglia del modello (il servizio mappa i livelli 2.5 sul budget). */
export function getThinkingLevelsForModel(model: string): readonly ThinkingLevel[] {
  return getThinkingFamily(model) === 'budget' ? ALL_LEVELS : ALL_LEVELS
}

export function isThinkingLevelValidForModel(model: string, level: string): level is ThinkingLevel {
  return (getThinkingLevelsForModel(model) as readonly string[]).includes(level)
}

/** Vero se il numero ha al massimo 6 decimali ed e' nell'intervallo del tipo NUMERIC(12,6). */
export function isValidPrice(value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > PRICE_MAX) return false
  const scaled = value * 1_000_000
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

interface GoogleModel {
  name?: unknown
  supportedGenerationMethods?: unknown
}

/** Tiene i modelli Gemini testuali/multimodali che supportano generateContent, ordinati e senza duplicati. */
export function filterTranscriptionModels(models: GoogleModel[]): string[] {
  const names = new Set<string>()
  for (const model of models) {
    if (typeof model.name !== 'string') continue
    const id = model.name.replace(/^models\//, '')
    const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : []
    if (!methods.includes('generateContent')) continue
    if (!id.startsWith('gemini') || EXCLUDED_MODEL_PARTS.test(id) || !MODEL_NAME_PATTERN.test(id)) continue
    names.add(id)
  }
  return Array.from(names).sort()
}

/** Chiavi Gemini candidate: credenziali configurate e non invalide, in ordine stabile. */
async function listCandidateOwners(admin: AdminClient): Promise<string[]> {
  const { data, error } = await admin
    .from('user_provider_credentials')
    .select('user_id, is_valid')
    .eq('provider', 'gemini')
    .eq('is_configured', true)
    .order('id', { ascending: true })
    .limit(MAX_KEYS_TRIED * 4)
  if (error) throw new Error('Impossibile leggere le credenziali Gemini')
  return (data ?? []).filter((row) => row.is_valid !== false).map((row) => row.user_id).slice(0, MAX_KEYS_TRIED)
}

/** Legge l'elenco modelli da Google con la prima chiave valida; registra l'uso sul proprietario della chiave. */
export async function listGeminiModels(
  admin: AdminClient,
  fetcher: typeof fetch = fetch
): Promise<ModelsListResult> {
  let owners: string[]
  try {
    owners = await listCandidateOwners(admin)
  } catch {
    return { status: 'error' }
  }

  for (const ownerId of owners) {
    const apiKey = await getProviderApiKeyForUserAsAdmin(ownerId, 'gemini').catch(() => null)
    if (!apiKey) continue
    try {
      const collected: GoogleModel[] = []
      let pageToken: string | null = null
      for (let page = 0; page < MODELS_MAX_PAGES; page += 1) {
        const query = new URLSearchParams({ pageSize: String(MODELS_PAGE_SIZE) })
        if (pageToken) query.set('pageToken', pageToken)
        const response = await fetchAndRecordProviderRequest({
          userId: ownerId,
          provider: 'gemini',
          operation: MODELS_LIST_OPERATION,
          url: `${GEMINI_API_BASE_URL}/models?${query.toString()}`,
          init: {
            method: 'GET',
            headers: { 'x-goog-api-key': apiKey },
            cache: 'no-store',
            signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
          },
          fetcher,
        })
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined)
          // 400/401/403 indicano una chiave non utilizzabile: si prova la successiva; altri errori fermano l'elenco.
          if (response.status === 400 || response.status === 401 || response.status === 403) {
            collected.length = 0
            pageToken = null
            break
          }
          return { status: 'error' }
        }
        const body = await response.json().catch(() => null) as { models?: GoogleModel[]; nextPageToken?: string } | null
        if (!body || !Array.isArray(body.models)) return { status: 'error' }
        collected.push(...body.models)
        pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null
        if (!pageToken) return { status: 'ok', models: filterTranscriptionModels(collected) }
      }
      if (pageToken) return { status: 'ok', models: filterTranscriptionModels(collected) }
    } catch {
      return { status: 'error' }
    }
  }
  return { status: 'no_key' }
}

const DEFAULT_PROFILE: TranscriptionProfileSettings = {
  model: 'gemini-3.1-flash-lite',
  thinkingLevel: 'minimal',
  inputPricePerMillion: 0.25,
  outputPricePerMillion: 1.5,
}

/** Legge il profilo corrente (o i default approvati se la riga manca). */
export async function getTranscriptionProfile(admin: AdminClient): Promise<TranscriptionProfileSettings> {
  const { data, error } = await admin
    .from('transcription_profile')
    .select('model, thinking_level, input_price_per_million, output_price_per_million')
    .eq('id', true)
    .maybeSingle()
  if (error) throw new Error('Impossibile leggere il profilo di trascrizione')
  if (!data) return DEFAULT_PROFILE
  return {
    model: data.model,
    thinkingLevel: data.thinking_level,
    inputPricePerMillion: Number(data.input_price_per_million),
    outputPricePerMillion: Number(data.output_price_per_million),
  }
}

export type UpdateProfileResult =
  | { ok: true; profile: TranscriptionProfileSettings }
  | { ok: false; code: 'INVALID_LEVEL' | 'MODELS_UNAVAILABLE' | 'MODEL_NOT_LISTED' }

/**
 * Valida e salva il profilo. Un cambio modello richiede un elenco Google disponibile che lo contenga;
 * senza elenco restano modificabili livello e prezzi del modello corrente.
 */
export async function updateTranscriptionProfile(
  admin: AdminClient,
  input: TranscriptionProfileSettings,
  adminUsername: string,
  fetcher: typeof fetch = fetch
): Promise<UpdateProfileResult> {
  if (!isThinkingLevelValidForModel(input.model, input.thinkingLevel)) return { ok: false, code: 'INVALID_LEVEL' }

  const current = await getTranscriptionProfile(admin)
  if (input.model !== current.model) {
    const list = await listGeminiModels(admin, fetcher)
    if (list.status !== 'ok') return { ok: false, code: 'MODELS_UNAVAILABLE' }
    if (!list.models.includes(input.model)) return { ok: false, code: 'MODEL_NOT_LISTED' }
  }

  const { data, error } = await admin.rpc('update_transcription_profile', {
    p_model: input.model,
    p_thinking_level: input.thinkingLevel,
    p_input_price: input.inputPricePerMillion,
    p_output_price: input.outputPricePerMillion,
    p_admin_username: adminUsername,
  })
  const row = data?.[0]
  if (error || !row) throw new Error('Impossibile salvare il profilo di trascrizione')
  return {
    ok: true,
    profile: {
      model: row.model,
      thinkingLevel: row.thinking_level,
      inputPricePerMillion: Number(row.input_price_per_million),
      outputPricePerMillion: Number(row.output_price_per_million),
    },
  }
}
