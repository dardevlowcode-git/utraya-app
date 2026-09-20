/* Commento didattico:
 * Scopo del file: configurazione di progetto usata in fase di build/esecuzione.
 * Flusso: questo file viene letto automaticamente da Next.js/tooling per definire il comportamento globale dell'app.
 */

import type { Config } from 'tailwindcss'

const withOpacity = (cssVariable: string) => `rgb(var(${cssVariable}) / <alpha-value>)`

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Warm Editorial tokens (CONVENTIONS.md §5)
        'canvas-cream': '#F3F0EE',
        'lifted-cream': '#FCFBFA',
        'ink-black': '#141413',
        'slate-gray': '#696969',
        'light-signal-orange': '#F37338',
        'signal-orange': '#CF4500',
        'white': '#FFFFFF',

        // Semantic aliases used by existing components.
        'primary': withOpacity('--color-primary'),
        'primary-container': withOpacity('--color-primary-container'),
        'on-primary': withOpacity('--color-on-primary'),
        'on-primary-container': withOpacity('--color-on-primary-container'),
        'primary-fixed': withOpacity('--color-primary-fixed'),
        'primary-fixed-dim': withOpacity('--color-primary-fixed-dim'),
        'on-primary-fixed': withOpacity('--color-on-primary-fixed'),
        'on-primary-fixed-variant': withOpacity('--color-on-primary-fixed-variant'),
        'inverse-primary': withOpacity('--color-inverse-primary'),

        'secondary': '#F37338',
        'secondary-container': '#CF4500',
        'on-secondary': '#FFFFFF',
        'on-secondary-container': '#FFFFFF',
        'secondary-fixed': '#FCE1D5',
        'secondary-fixed-dim': '#F9BF9F',
        'on-secondary-fixed': '#5E1D00',
        'on-secondary-fixed-variant': '#8F2E00',

        // "Tertiary" alias preserved for backward-compatibility; mapped to orange family.
        'tertiary': '#F37338',
        'tertiary-container': '#CF4500',
        'on-tertiary': '#FFFFFF',
        'on-tertiary-container': '#FFFFFF',
        'tertiary-fixed': '#FCE1D5',
        'tertiary-fixed-dim': '#F9BF9F',
        'on-tertiary-fixed': '#5E1D00',
        'on-tertiary-fixed-variant': '#8F2E00',

        'surface': withOpacity('--color-surface'),
        'surface-base': withOpacity('--color-surface'),
        'surface-elevated': withOpacity('--color-surface-container-low'),
        'surface-statement': withOpacity('--color-surface-container-lowest'),
        'surface-dim': withOpacity('--color-surface-dim'),
        'surface-bright': withOpacity('--color-surface-bright'),
        'surface-container-lowest': withOpacity('--color-surface-container-lowest'),
        'surface-container-low': withOpacity('--color-surface-container-low'),
        'surface-container': withOpacity('--color-surface-container'),
        'surface-container-high': withOpacity('--color-surface-container-high'),
        'surface-container-highest': withOpacity('--color-surface-container-highest'),
        'surface-variant': withOpacity('--color-surface-variant'),
        'surface-tint': '#F37338',

        'on-surface': withOpacity('--color-on-surface'),
        'on-surface-variant': withOpacity('--color-on-surface-variant'),
        'inverse-surface': withOpacity('--color-inverse-surface'),
        'inverse-on-surface': withOpacity('--color-inverse-on-surface'),

        'background': withOpacity('--color-background'),
        'on-background': withOpacity('--color-on-background'),

        'outline': withOpacity('--color-outline'),
        'outline-variant': withOpacity('--color-outline-variant'),
        'stroke-subtle': withOpacity('--color-outline-variant'),
        'stroke-strong': withOpacity('--color-outline'),

        // Error
        'error': '#ba1a1a',
        'error-container': '#ffdad6',
        'on-error': '#ffffff',
        'on-error-container': '#93000a',
      },

      fontFamily: {
        headline: ['var(--font-sofia-sans)', 'Inter', 'Arial', 'sans-serif'],
        body: ['var(--font-sofia-sans)', 'Inter', 'Arial', 'sans-serif'],
        label: ['var(--font-sofia-sans)', 'Inter', 'Arial', 'sans-serif'],
        sans: ['var(--font-sofia-sans)', 'Inter', 'Arial', 'sans-serif'],
      },

      borderRadius: {
        DEFAULT: '1.25rem',
        sm: '0.75rem',
        md: '1.25rem',
        lg: '2.5rem',
        xl: '2.5rem',
        '2xl': '2.5rem',
        full: '999px',
      },

      boxShadow: {
        'ambient': '0 8px 24px rgba(20, 20, 19, 0.06)',
        'ambient-lg': '0 14px 34px rgba(20, 20, 19, 0.12)',
        'ambient-md': '0 4px 16px rgba(20, 20, 19, 0.08)',
        'soft': '0 6px 18px rgba(20, 20, 19, 0.08)',
        'medium': '0 14px 34px rgba(20, 20, 19, 0.12)',
        'hero': '0 24px 60px rgba(20, 20, 19, 0.16)',
        'primary-glow': '0 6px 20px rgba(20, 20, 19, 0.18)',
        'tertiary-glow': '0 6px 20px rgba(243, 115, 56, 0.22)',
      },

      animation: {
        'pulse-soft': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-in': 'slideIn 0.25s ease-out',
      },

      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },

      backdropBlur: {
        glass: '12px',
      },
    },
  },
  plugins: [],
}

export default config
