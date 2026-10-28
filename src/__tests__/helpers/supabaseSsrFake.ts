/* Commento didattico:
 * Scopo del file: crea il client SSR Supabase finto condiviso dai test proxy e sessione admin.
 * Moduli richiamati: `vitest` per il tipo dei mock dei confini Supabase.
 * Flusso: collega gli spy forniti al client atteso dal proxy, senza rete né database.
 */

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
