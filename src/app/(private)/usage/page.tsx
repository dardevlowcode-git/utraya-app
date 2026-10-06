/* Commento didattico:
 * Scopo: mostra all'utente il riepilogo delle chiamate API personali degli ultimi 30 giorni.
 * Moduli richiamati: `next/link`, `@/lib/auth/provider`, `@/lib/services/api-usage`, `next-intl`.
 * Flusso: carica dati con sessione Supabase e RLS; la pagina non riceve né espone credenziali o payload provider.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { getCurrentSession } from '@/lib/auth/provider'
import { getApiUsageDashboard } from '@/lib/services/api-usage'
import { getFormatter, getTranslations } from 'next-intl/server'

/** Restituisce i metadati della pagina nella lingua attiva. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('usage')
  return {
    title: t('title'),
    description: t('subtitle'),
  }
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
  const [format, t] = await Promise.all([getFormatter(), getTranslations()])
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

      <aside
        aria-label={t('usage.dataCompleteness')}
        className="mb-6 rounded-2xl bg-surface-container p-4 text-sm leading-relaxed text-on-surface-variant"
      >
        {t('usage.bestEffortWarning')}
      </aside>

      <section aria-label={t('usage.title')} className="mb-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl bg-surface-container-lowest p-6 shadow-ambient">
          <h2 className="font-headline text-lg font-bold text-on-surface">{t('usage.gemini')}</h2>
          <p className="mt-4 text-3xl font-extrabold text-on-surface">
            {gemini.totalTokens === null ? t('usage.notAvailable') : format.number(gemini.totalTokens)}{' '}
            <span className="text-base font-semibold text-on-surface-variant">{t('usage.totalTokens')}</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-on-surface-variant">{t('usage.inputTokens')}</dt>
              <dd className="font-semibold text-on-surface">
                {gemini.inputTokens === null ? t('usage.notAvailable') : format.number(gemini.inputTokens)}
              </dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.outputTokens')}</dt>
              <dd className="font-semibold text-on-surface">
                {gemini.outputTokens === null ? t('usage.notAvailable') : format.number(gemini.outputTokens)}
              </dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.requests')}</dt>
              <dd className="font-semibold text-on-surface">{format.number(gemini.requestCount)}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.estimatedCost')}</dt>
              <dd className="font-semibold text-on-surface">
                {gemini.estimatedCostUsd === null
                  ? t('usage.notAvailable')
                  : format.number(gemini.estimatedCostUsd, {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 6,
                    maximumFractionDigits: 6,
                  })}
              </dd>
            </div>
          </dl>
          {gemini.usageQuality === 'unknown' && (
            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
              {t('usage.summaryUnknown', { count: gemini.unknownUsageCount })}
            </p>
          )}
          {gemini.usageQuality === 'partial' && (
            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
              {t('usage.summaryPartial', { count: gemini.unknownUsageCount })}
            </p>
          )}
          <p className="mt-4 text-xs leading-relaxed text-on-surface-variant">
            {t('usage.costNote')}
          </p>
        </article>

        <article className="rounded-2xl bg-surface-container-lowest p-6 shadow-ambient">
          <h2 className="font-headline text-lg font-bold text-on-surface">{t('usage.youtube')}</h2>
          <p className="mt-4 text-3xl font-extrabold text-on-surface">
            {format.number(youtube.requestCount)}{' '}
            <span className="text-base font-semibold text-on-surface-variant">{t('usage.requests')}</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-on-surface-variant">{t('usage.quotaUnits')}</dt>
              <dd className="font-semibold text-on-surface">
                {youtube.quotaUnits === null ? t('usage.notAvailable') : format.number(youtube.quotaUnits)}
              </dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">{t('usage.estimatedCost')}</dt>
              <dd className="font-semibold text-on-surface">{t('usage.notAvailable')}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-on-surface-variant">
            {t('usage.quotaNote')}
          </p>
          {youtube.usageQuality === 'unknown' && (
            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
              {t('usage.summaryUnknown', { count: youtube.unknownUsageCount })}
            </p>
          )}
          {youtube.usageQuality === 'partial' && (
            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
              {t('usage.summaryPartial', { count: youtube.unknownUsageCount })}
            </p>
          )}
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-ambient">
        <div className="flex flex-wrap items-end justify-between gap-3 bg-surface-container-low p-5 md:p-6">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">
              {t('usage.recent')}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {t('usage.subtitle')}
            </p>
          </div>
          <Link
            href="/integrations"
            className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-primary hover:bg-surface-container hover:underline"
          >
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
                  const provider = event.provider === 'gemini' ? t('usage.gemini') : t('usage.youtube')
                  const outcome = event.outcome === 'success'
                    ? t('usage.success')
                    : event.httpStatus
                      ? `HTTP ${event.httpStatus}`
                      : event.outcome === 'timeout'
                        ? t('usage.timeout')
                        : t('usage.networkError')
                  const usageDetail = event.provider === 'gemini'
                    ? event.inputTokens === null && event.outputTokens === null && event.totalTokens === null
                      ? t('usage.tokenUnavailable')
                      : [
                        `${event.inputTokens === null ? t('usage.notAvailable') : format.number(event.inputTokens)} ${t('usage.inputShort')}`,
                        `${event.outputTokens === null ? t('usage.notAvailable') : format.number(event.outputTokens)} ${t('usage.outputShort')}`,
                        `${event.totalTokens === null ? t('usage.notAvailable') : format.number(event.totalTokens)} ${t('usage.totalShort')}`,
                      ].join(' · ')
                    : `${event.quotaUnits === null ? t('usage.notAvailable') : format.number(event.quotaUnits)} ${t('usage.quotaUnitsShort')}${event.quotaBucket === 'search' ? ` · ${t('usage.searchBucket')}` : ''}`

                  return (
                    <tr key={event.id} className="align-top odd:bg-surface-container-lowest even:bg-surface-container-low">
                      <td className="whitespace-nowrap px-5 py-4 text-on-surface-variant">
                        {format.dateTime(new Date(event.occurredAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'UTC',
                        })}
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-semibold text-on-surface">{provider}</span>
                        <span className="mt-1 block font-mono text-xs text-on-surface-variant">{event.operation}{event.model ? ` · ${event.model}` : ''}</span>
                      </td>
                      <td className="px-5 py-4 text-on-surface-variant">{outcome}</td>
                      <td className="px-5 py-4 text-on-surface-variant">{usageDetail}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-on-surface">
                        {event.provider === 'gemini'
                          ? event.estimatedCostUsd === null
                            ? t('usage.notAvailable')
                            : format.number(event.estimatedCostUsd, {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 6,
                              maximumFractionDigits: 6,
                            })
                          : t('usage.notAvailable')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {usage.totalEvents > 0 && (
          <nav aria-label={t('usage.pagination')} className="flex items-center justify-between bg-surface-container-low px-5 py-4">
            <span className="text-sm text-on-surface-variant">
              {t('usage.page', { current: usage.page, total: usage.totalPages, count: usage.totalEvents })}
            </span>
            <div className="flex gap-2">
              {usage.page > 1 && (
                <Link
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-surface-container-lowest px-3 text-sm hover:bg-surface-container"
                  href={`/usage?page=${usage.page - 1}`}
                >
                  {t('usage.previous')}
                </Link>
              )}
              {usage.page < usage.totalPages && (
                <Link
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-surface-container-lowest px-3 text-sm hover:bg-surface-container"
                  href={`/usage?page=${usage.page + 1}`}
                >
                  {t('usage.next')}
                </Link>
              )}
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
