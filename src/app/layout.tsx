/* Commento didattico:
 * Scopo del file: definisce il layout radice dell'applicazione: qui si collegano stili globali, provider e struttura base.
 * Moduli richiamati: `next`, `next-intl`, `next-intl/server`
 * Flusso: Questo modulo viene importato dove serve per mantenere separata la responsabilita` del codice.
 */

import type { Metadata } from 'next'
import { Inter, Sofia_Sans } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { cookies } from 'next/headers'
import { getSiteUrl } from '@/lib/env/getSiteUrl'
import './globals.css'

const sofiaSans = Sofia_Sans({
  subsets: ['latin'],
  variable: '--font-sofia-sans',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Utraya',
    template: '%s | Utraya',
  },
  metadataBase: new URL(getSiteUrl()),
  description:
    'Utraya analizza automaticamente i tuoi canali YouTube preferiti così rimani sempre informato in pochi minuti.',
  keywords: ['YouTube', 'AI', 'riepiloghi', 'canali', 'video', 'intelligenza artificiale'],
  authors: [{ name: 'Utraya' }],
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    title: 'Utraya — Consuma YouTube più velocemente con l\'AI',
    description:
      'Riepiloghi AI dei tuoi canali YouTube preferiti. Capisci video da 30 minuti in 60 secondi.',
    siteName: 'Utraya',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()
  const messages = await getMessages()
  const cookieStore = await cookies()
  const themeFromCookie = cookieStore.get('theme')?.value
  const initialTheme = themeFromCookie === 'dark' ? 'dark' : 'light'

  return (
    <html lang={locale} data-theme={initialTheme} suppressHydrationWarning>
      <body className={`${sofiaSans.variable} ${inter.variable} min-h-screen bg-surface text-on-surface antialiased`}>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
