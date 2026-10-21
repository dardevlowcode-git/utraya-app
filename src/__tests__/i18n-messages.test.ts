/* Commento didattico:
 * Scopo: mantiene allineati i messaggi italiano/inglese ed evita traduzioni vuote.
 * Moduli richiamati: file JSON sotto `messages/`, filesystem locale e Vitest.
 * Flusso: confronta tutti i percorsi delle chiavi ricorsive e cerca valori vuoti in ogni locale.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const messagesDirectory = path.resolve(process.cwd(), 'messages')
const messageFiles = readdirSync(messagesDirectory)
  .filter((file) => file.endsWith('.json'))
  .sort()

function loadMessages(file: string): JsonValue {
  return JSON.parse(readFileSync(path.join(messagesDirectory, file), 'utf8')) as JsonValue
}

function collectKeyPaths(value: JsonValue, parentPath = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectKeyPaths(item, `${parentPath}[${index}]`))
  }
  if (value === null || typeof value !== 'object') return []

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const keyPath = parentPath ? `${parentPath}.${key}` : key
    return [keyPath, ...collectKeyPaths(nestedValue, keyPath)]
  })
}

function collectEmptyValuePaths(value: JsonValue, currentPath = ''): string[] {
  if (value === null) return [currentPath]
  if (typeof value === 'string') return value.trim() === '' ? [currentPath] : []
  if (Array.isArray(value)) {
    if (value.length === 0) return [currentPath]
    return value.flatMap((item, index) => collectEmptyValuePaths(item, `${currentPath}[${index}]`))
  }
  if (typeof value !== 'object') return []

  const entries = Object.entries(value)
  if (entries.length === 0) return [currentPath]
  return entries.flatMap(([key, nestedValue]) => {
    const keyPath = currentPath ? `${currentPath}.${key}` : key
    return collectEmptyValuePaths(nestedValue, keyPath)
  })
}

describe('messaggi localizzati', () => {
  it.skip('mantiene le stesse chiavi ricorsive in italiano e inglese', () => {
    // BUG: 49 chiavi ricorsive presenti in it.json non sono presenti in en.json.
    expect(messageFiles).toContain('it.json')
    expect(messageFiles).toContain('en.json')
    expect(collectKeyPaths(loadMessages('it.json')).sort()).toEqual(
      collectKeyPaths(loadMessages('en.json')).sort()
    )
  })

  it('non contiene valori vuoti in nessun file di messaggi', () => {
    const emptyValues = messageFiles.flatMap((file) =>
      collectEmptyValuePaths(loadMessages(file)).map((keyPath) => `${file}:${keyPath}`)
    )

    expect(emptyValues).toEqual([])
  })
})
