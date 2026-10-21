import { existsSync, readFileSync } from 'node:fs'

const CONTAINER_MARKERS = ['/.dockerenv', '/run/.containerenv']
const CONTAINER_CGROUP = /(?:^|[/.-])(?:docker|containerd|kubepods|libpod|podman|lxc)(?:[/.:-]|$)/im

/** Fail-closed check requiring a runtime marker and independent container evidence. */
export function isRunningInContainer(fileSystem = { existsSync, readFileSync }) {
  try {
    if (!CONTAINER_MARKERS.some((marker) => fileSystem.existsSync(marker))) return false

    const cgroup = fileSystem.readFileSync('/proc/1/cgroup', 'utf8')
    const mountinfo = fileSystem.readFileSync('/proc/1/mountinfo', 'utf8')
    const hasContainerCgroup = CONTAINER_CGROUP.test(cgroup)
    const hasOverlayRoot = mountinfo.split('\n').some((line) => {
      const [mountFields, fileSystemFields] = line.split(' - ')
      if (!mountFields || !fileSystemFields) return false

      const mountPoint = mountFields.trim().split(/\s+/)[4]
      const fileSystemType = fileSystemFields.trim().split(/\s+/)[0]
      return mountPoint === '/' && fileSystemType === 'overlay'
    })

    return hasContainerCgroup || hasOverlayRoot
  } catch {
    return false
  }
}
