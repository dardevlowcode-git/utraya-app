/* Commento didattico:
 * Scopo: verifica che gli smoke rifiutino host normali e accettino container supportati.
 * Moduli richiamati: `vitest`, `scripts/container-check.mjs`.
 * Flusso: simula marker, cgroup e mount root senza dipendere dal container del test runner.
 */

import { describe, expect, it } from 'vitest'
import { isRunningInContainer } from '../../../scripts/container-check.mjs'

const dockerRootMount = '36 25 0:32 / / rw,relatime - overlay overlay rw,lowerdir=/layers'
const hostRootMount = '36 25 8:1 / / rw,relatime - ext4 /dev/sda1 rw'

function checkContainer({
  markers = [],
  mountinfo = hostRootMount,
  cgroup = '0::/user.slice',
}: {
  markers?: string[]
  mountinfo?: string
  cgroup?: string
} = {}): boolean {
  return isRunningInContainer({
    existsSync: (path) => markers.includes(path),
    readFileSync: (path) => path === '/proc/1/mountinfo' ? mountinfo : cgroup,
  })
}

describe('container check', () => {
  it('accetta un Docker identificato dal marker e dal filesystem root overlay', () => {
    expect(checkContainer({ markers: ['/.dockerenv'], mountinfo: dockerRootMount })).toBe(true)
  })

  it('accetta Podman quando il marker è corroborato dal cgroup del runtime', () => {
    expect(checkContainer({
      markers: ['/run/.containerenv'],
      cgroup: '0::/machine.slice/libpod-abc.scope',
    })).toBe(true)
  })

  it('rifiuta il solo marker Docker senza una seconda evidenza del container', () => {
    expect(checkContainer({ markers: ['/.dockerenv'] })).toBe(false)
  })

  it('rifiuta un filesystem overlay sul host se manca un marker container', () => {
    expect(checkContainer({ mountinfo: dockerRootMount })).toBe(false)
  })

  it('rifiuta evidenze overlay su mount diversi da root', () => {
    expect(checkContainer({
      markers: ['/.dockerenv'],
      mountinfo: '36 25 0:32 / /workspace rw - overlay overlay rw',
    })).toBe(false)
  })
})
