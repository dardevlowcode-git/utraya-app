/* Commento didattico:
 * Scopo: mostra all'utente il riepilogo delle chiamate API personali degli ultimi 30 giorni.
 * Moduli richiamati: `next/link`, `@/lib/auth/provider`, `@/lib/services/api-usage`, `next-intl`.
 * Flusso: carica dati con sessione Supabase e RLS; la pagina non riceve né espone credenziali o payload provider.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { getCurrentSession } from '@/lib/auth/provider'
import { getApiUsageDashboard } from '@/lib/services/api-usage'
import { getLocale, getTranslations } from 'next-intl/server'

/** Restituisce i metadati della pagina nella lingua attiva. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('usage')
  return {
    title: t('title'),
    description: t('subtitle'),
  }
}

function formatUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  }).format(value)
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

export default async function ApiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const session = await getCurrentSession()
  if (!session) return null

  const { page: pageParam } = await searchParams
  const pageValue = pageParam ?? '1'
  const parsedPage = /^\d+$/.test(pageValue) ? Number(pageValue) : Number.NaN
  const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const [locale, t] = await Promise.all([getLocale(), getTranslations()])
  const usage = await getApiUsageDashboard(session.userId, requestedPage)
  const gemini = usage.summaries.find((summary) => summary.provider === 'gemini')!
  const youtube = usage.summaries.find((summary) => summary.provider === 'youtube')!

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          {t('usage.title')}
        </p>
        <h1 className="mt-2 font-headline text-3xl font-extrabold tracking-tight text-on-surface md:text-4xl">
          {t('usage.title')}
        </h1>
        <p className="mt-2 max-w-3xl text-on-surface-variant">
          {t('usage.subtitle')}
        </p>
      </header>

      <section aria-label={t('usage.title')} className="mb-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl bg-surface-container-lowest p-6 shadow-ambient">
          <h2 className="font-headline text-lg font-bold text-on-surface">{t('usage.gemini')}</h2>
          <p className="mt-4 text-3xl font-extrabold text-on-surface">
            {formatNumber(gemini.totalTokens, locale)} <span className="text-base font-semibold text-on-surface-variant">{t('usage.tokens')}</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-on-surface-variant">{t('usage.inputTokens')}</dt>
              <dd className="font-semibold text-on-surface">{formatNumber(gemini.inputTokens, locale)}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.outputTokens')}</dt>
              <dd className="font-semibold text-on-surface">{formatNumber(gemini.outputTokens, locale)}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.requests')}</dt>
              <dd className="font-semibold text-on-surface">{formatNumber(gemini.requestCount, locale)}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.estimatedCost')}</dt>
              <dd className="font-semibold text-on-surface">{formatUsd(gemini.estimatedCostUsd, locale)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-on-surface-variant">
            {t('usage.costNote')}
          </p>
        </article>

        <article className="rounded-2xl bg-surface-container-lowest p-6 shadow-ambient">
          <h2 className="font-headline text-lg font-bold text-on-surface">{t('usage.youtube')}</h2>
          <p className="mt-4 text-3xl font-extrabold text-on-surface">
            {formatNumber(youtube.requestCount, locale)} <span className="text-base font-semibold text-on-surface-variant">{t('usage.requests')}</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-on-surface-variant">{t('usage.quotaUnits')}</dt>
              <dd className="font-semibold text-on-surface">{formatNumber(youtube.quotaUnits, locale)}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.estimatedCost')}</dt>
              <dd className="font-semibold text-on-surface">—</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-on-surface-variant">
            {t('usage.quotaNote')}
          </p>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-ambient">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stroke-subtle p-5 md:p-6">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">
              {t('usage.recent')}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {t('usage.subtitle')}
            </p>
          </div>
          <Link href="/integrations" className="text-sm font-semibold text-primary hover:underline">
            {t('usage.manageKeys')}
          </Link>
        </div>

        {usage.events.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-semibold text-on-surface">
              {t('usage.empty')}
            </p>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              {t('usage.emptyDetail')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-surface-container text-xs uppercase tracking-wide text-on-surface-variant">
                <tr>
                  <th className="px-5 py-3 font-semibold">{t('usage.date')}</th>
                  <th className="px-5 py-3 font-semibold">{t('usage.providerMethod')}</th>
                  <th className="px-5 py-3 font-semibold">{t('usage.result')}</th>
                  <th className="px-5 py-3 font-semibold">{t('usage.consumption')}</th>
                  <th className="px-5 py-3 text-right font-semibold">{t('usage.estimate')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.events.map((event) => {
                  const provider = event.provider === 'gemini' ? 'Gemini' : 'YouTube'
                  const outcome = event.outcome === 'success'
                    ? t('usage.success')
                    : event.http_status
                      ? `HTTP ${event.http_status}`
                      : event.outcome === 'timeout'
                        ? t('usage.timeout')
                        : t('usage.networkError')
                  const usageDetail = event.provider === 'gemini'
                    ? event.input_tokens === null || event.output_tokens === null
                      ? t('usage.tokenUnavailable')
                      : `${formatNumber(event.input_tokens, locale)} in / ${formatNumber(event.output_tokens, locale)} out`
                    : `${formatNumber(event.quota_units ?? 0, locale)} ${t('usage.quotaUnitsShort')}${event.quota_bucket === 'search' ? ' · search' : ''}`

                  return (
                    <tr key={event.id} className="border-t border-stroke-subtle align-top">
                      <td className="whitespace-nowrap px-5 py-4 text-on-surface-variant">{formatDate(event.occurred_at, locale)}</td>
                      <td className="px-5 py-4">
                        <span className="font-semibold text-on-surface">{provider}</span>
                        <span className="mt-1 block font-mono text-xs text-on-surface-variant">{event.operation}{event.model ? ` · ${event.model}` : ''}</span>
                      </td>
                      <td className="px-5 py-4 text-on-surface-variant">{outcome}</td>
                      <td className="px-5 py-4 text-on-surface-variant">{usageDetail}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-on-surface">
                        {event.provider === 'gemini'
                          ? event.estimated_cost_usd === null ? '—' : formatUsd(event.estimated_cost_usd, locale)
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {usage.totalEvents > 0 && (
          <nav aria-label={session.preferredLanguage === 'en' ? 'Request pages' : 'Pagine chiamate'} className="flex items-center justify-between border-t border-stroke-subtle px-5 py-4">
            <span className="text-sm text-on-surface-variant">
              {t('usage.page', { current: usage.page, total: usage.totalPages, count: usage.totalEvents })}
            </span>
            <div className="flex gap-2">
              {usage.page > 1 && <Link className="rounded-lg border border-stroke-subtle px-3 py-2 text-sm hover:bg-surface-container" href={`/usage?page=${usage.page - 1}`}>{t('usage.previous')}</Link>}
              {usage.page < usage.totalPages && <Link className="rounded-lg border border-stroke-subtle px-3 py-2 text-sm hover:bg-surface-container" href={`/usage?page=${usage.page + 1}`}>{t('usage.next')}</Link>}
            </div>
          </nav>
        )}
      </section>

      <p className="mt-5 text-xs leading-relaxed text-on-surface-variant">
        {t('usage.privacyNote')}
      </p>
    </main>
  )
}
