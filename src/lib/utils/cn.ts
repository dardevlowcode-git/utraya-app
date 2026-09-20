/* Commento didattico:
 * Scopo del file: fornisce funzioni di utilita` riusabili in piu` punti del progetto.
 * Moduli richiamati: nessun import esterno: il file usa logica locale o sole primitive del linguaggio.
 * Flusso: Le utility vengono richiamate da moduli diversi per evitare duplicazioni e standardizzare comportamenti comuni.
 */

/**
 * Utility per combinare classi Tailwind CSS.
 * Semplice alternativa a clsx/classnames senza dipendenze extra.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
