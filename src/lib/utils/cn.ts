/**
 * Utility per combinare classi Tailwind CSS.
 * Semplice alternativa a clsx/classnames senza dipendenze extra.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
