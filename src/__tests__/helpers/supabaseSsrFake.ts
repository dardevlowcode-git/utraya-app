import type { Mock } from 'vitest'

type SupabaseSsrFakeMocks = {
  getUserMock: Mock
  rpcMock: Mock
  maybeSingleMock: Mock
  fromMock: Mock
}

export function createSupabaseSsrFake({ getUserMock, rpcMock, maybeSingleMock, fromMock }: SupabaseSsrFakeMocks) {
  return {
    auth: { getUser: getUserMock },
    rpc: rpcMock,
    from: (table: string) => {
      fromMock(table)
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.maybeSingle = maybeSingleMock
      return builder
    },
  }
}
