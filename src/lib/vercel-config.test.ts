/* Commento didattico:
 * Scopo del file: impedisce cron incompatibili con il piano Vercel gratuito (Hobby, al massimo giornalieri).
 * Moduli richiamati: vercel.json e vitest.
 * Flusso: legge la configurazione e verifica che nessuna schedule giri più di una volta al giorno.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> }

describe('vercel.json crons', () => {
  it('non contiene schedule più frequenti di una al giorno', () => {
    for (const cron of config.crons) {
      const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.schedule.split(' ')
      expect(minute).toMatch(/^\d+$/)
      expect(hour).toMatch(/^\d+$/)
      expect(`${dayOfMonth} ${month} ${dayOfWeek}`).toBe('* * *')
    }
  })

  it('non schedula più il worker credential-validations', () => {
    expect(config.crons.map((cron) => cron.path)).not.toContain('/api/cron/credential-validations')
    expect(config.crons.map((cron) => cron.path)).toEqual(expect.arrayContaining(['/api/cron/daily-sync']))
  })
})
