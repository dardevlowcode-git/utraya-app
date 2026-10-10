/* Commento didattico:
 * Scopo del file: condivide il massimo rappresentabile per i limiti retry fra UI, API e servizi.
 * Moduli richiamati: nessuno.
 * Flusso: il valore riflette l'intervallo intero PostgreSQL e non un limite di prodotto arbitrario.
 */

export const RETRY_LIMIT_MAX = 2_147_483_647
