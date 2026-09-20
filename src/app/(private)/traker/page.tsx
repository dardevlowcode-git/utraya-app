/* Commento didattico:
 * Scopo del file: mantiene compatibilita con la route "traker" reindirizzando alla pagina tracker.
 * Moduli richiamati: `next/navigation`
 * Flusso: qualsiasi accesso a /traker viene inoltrato a /tracker.
 */

import { redirect } from 'next/navigation'

interface TrakerAliasPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function appendQuery(basePath: string, searchParams?: Record<string, string | string[] | undefined>): string {
  if (!searchParams) return basePath

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
      continue
    }
    if (typeof value === 'string') params.set(key, value)
  }

  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
}

export default async function TrakerAliasPage({ searchParams }: TrakerAliasPageProps) {
  const resolvedSearchParams = await searchParams
  redirect(appendQuery('/tracker', resolvedSearchParams))
}
