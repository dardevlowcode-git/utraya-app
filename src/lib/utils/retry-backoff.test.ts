import { describe, expect, it } from 'vitest'
import { computeRetryAt } from './retry-backoff'

describe('computeRetryAt', () => {
  it('usa backoff esponenziale con limite massimo di 60 secondi', () => {
    expect(computeRetryAt(1, null, 1_000)).toBe('1970-01-01T00:00:02.000Z')
    expect(computeRetryAt(7, null, 1_000)).toBe('1970-01-01T00:01:01.000Z')
  })

  it('rispetta Retry-After in secondi o come data HTTP quando supera il backoff', () => {
    expect(computeRetryAt(1, '5', 1_000)).toBe('1970-01-01T00:00:06.000Z')
    expect(computeRetryAt(1, 'Thu, 01 Jan 1970 00:00:08 GMT', 1_000)).toBe('1970-01-01T00:00:08.000Z')
  })

  it('ignora Retry-After invalido o nel passato e mantiene il backoff', () => {
    expect(computeRetryAt(2, 'not-a-delay', 1_000)).toBe('1970-01-01T00:00:03.000Z')
    expect(computeRetryAt(2, '0', 1_000)).toBe('1970-01-01T00:00:03.000Z')
  })
})
