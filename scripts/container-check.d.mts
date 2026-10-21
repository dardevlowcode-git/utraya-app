export interface ContainerRuntimeFs {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf8'): string
}

export function isRunningInContainer(fileSystem?: ContainerRuntimeFs): boolean
