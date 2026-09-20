/* Commento didattico:
 * Scopo del file: costruisce un nome job leggibile e coerente in UI admin.
 * Moduli richiamati: nessuno.
 * Flusso: Usa dati job + lookup utente/canale per produrre etichetta unitaria "utente · canale · id".
 */

interface JobLabelInput {
  id: string
  created_by_user_id?: string | null
  payload?: unknown
}

type UserLookup = Record<string, string>
type ChannelLookup = Record<string, string>

/**
 * Ritorna l'id breve (8 char) per rendere il riferimento unico ma compatto.
 */
function shortId(value: string): string {
  return value.slice(0, 8)
}

/**
 * Estrae channelId dal payload job se presente.
 */
function readChannelId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = (payload as { channelId?: unknown }).channelId
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

/**
 * Estrae userId dal payload job se presente.
 */
function readUserIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = (payload as { userId?: unknown }).userId
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

/**
 * Crea etichetta unitaria: utente + canale + id univoco breve.
 */
export function buildJobLabel(
  job: JobLabelInput,
  usersById: UserLookup,
  channelsById: ChannelLookup
): string {
  const payloadUserId = readUserIdFromPayload(job.payload)
  const effectiveUserId = payloadUserId ?? job.created_by_user_id ?? null
  const channelId = readChannelId(job.payload)

  const userName = effectiveUserId ? usersById[effectiveUserId] ?? `user:${shortId(effectiveUserId)}` : 'user:system'
  const channelName = channelId ? channelsById[channelId] ?? `channel:${shortId(channelId)}` : 'channel:n/a'

  return `${userName} · ${channelName} · ${shortId(job.id)}`
}

/**
 * Utility per raccogliere userId candidati da una lista job.
 */
export function collectJobUserIds(
  jobs: Array<{ created_by_user_id?: string | null; payload?: unknown }>
): string[] {
  const ids = new Set<string>()
  for (const job of jobs) {
    if (job.created_by_user_id) ids.add(job.created_by_user_id)
    const fromPayload = readUserIdFromPayload(job.payload)
    if (fromPayload) ids.add(fromPayload)
  }
  return [...ids]
}

/**
 * Utility per raccogliere channelId candidati da una lista job.
 */
export function collectJobChannelIds(
  jobs: Array<{ payload?: unknown }>
): string[] {
  const ids = new Set<string>()
  for (const job of jobs) {
    const channelId = readChannelId(job.payload)
    if (channelId) ids.add(channelId)
  }
  return [...ids]
}
