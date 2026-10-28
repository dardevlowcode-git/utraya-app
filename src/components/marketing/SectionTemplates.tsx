import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

type SectionTone = 'base' | 'elevated' | 'statement'
type GridColumns = '2' | '3'

function toneClass(tone: SectionTone): string {
  if (tone === 'elevated') return 'bg-surface-elevated'
  if (tone === 'statement') return 'bg-surface-statement'
  return 'bg-surface-base'
}

export function SplitHeroSection({
  title,
  subtitle,
  actions,
  aside,
  tone = 'base',
}: {
  title: ReactNode
  subtitle: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  tone?: SectionTone
}) {
  return (
    <section className={cn('layout-split-hero px-6 py-16 md:py-20', toneClass(tone))}>
      <div className="mx-auto grid w-full max-w-7xl items-start gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <h1 className="text-display-hero text-on-surface">{title}</h1>
          <div className="mt-6 text-body-lg text-on-surface-variant">{subtitle}</div>
          {actions ? <div className="mt-10 flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>
        {aside ? <div className="lg:col-span-5">{aside}</div> : null}
      </div>
    </section>
  )
}

export function EditorialGridSection({
  title,
  subtitle,
  children,
  columns = '3',
  tone = 'base',
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  columns?: GridColumns
  tone?: SectionTone
}) {
  return (
    <section className={cn('layout-editorial-grid px-6 py-16 md:py-20', toneClass(tone))}>
      <div className="mx-auto w-full max-w-7xl">
        <h2 className="text-section-title text-on-surface">{title}</h2>
        {subtitle ? <div className="mt-3 max-w-3xl text-body-lg text-on-surface-variant">{subtitle}</div> : null}
        <div className={cn('mt-10 grid gap-6', columns === '2' ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3')}>
          {children}
        </div>
      </div>
    </section>
  )
}

export function StatementBand({
  title,
  description,
  actions,
  inverse = false,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  inverse?: boolean
}) {
  return (
    <section className="px-6 py-16 md:py-20">
      <div
        className={cn(
          'layout-statement-band mx-auto max-w-5xl rounded-[40px] px-8 py-12 text-center md:px-12',
          inverse ? 'bg-primary text-on-primary' : 'bg-surface-elevated text-on-surface'
        )}
      >
        <h2 className={cn('text-section-title', inverse ? 'text-on-primary' : 'text-on-surface')}>{title}</h2>
        {description ? (
          <div className={cn('mx-auto mt-4 max-w-3xl text-body-lg', inverse ? 'text-on-primary' : 'text-on-surface-variant')}>
            {description}
          </div>
        ) : null}
        {actions ? <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
      </div>
    </section>
  )
}
