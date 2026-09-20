/* Commento didattico:
 * Scopo del file: configura il comportamento globale di Next.js (build, lint, immagini, plugin i18n).
 * Moduli richiamati: `next-intl/plugin`
 * Flusso: Next.js legge questa configurazione all'avvio/build per applicare plugin e opzioni runtime.
 */

import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts')

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://youtube.com",
      "img-src 'self' data: https://i.ytimg.com https://yt3.ggpht.com https://lh3.googleusercontent.com",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://*.supabase.co https://www.googleapis.com",
      "object-src 'none'",
    ].join('; '),
  },
]

const nextConfig = {
  // Output standalone SOLO per la build Docker (Dockerfile imposta DOCKER_OUTPUT=1).
  // Su Vercel deve restare l'output standard: con Next 16.3+ lo standalone sposta
  // i file di tracing (.nft.json) sotto .next/standalone e il builder Vercel non
  // li trova piu (deploy fallito dal 12/09/2026 con Next 16.3.4).
  output: process.env.DOCKER_OUTPUT === '1' ? 'standalone' : undefined,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: 'yt3.ggpht.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
}

export default withNextIntl(nextConfig)
