/* Commento didattico:
 * Scopo del file: gestisce la configurazione internazionale (lingue supportate, caricamento messaggi e locale corrente).
 * Moduli richiamati: `next-intl/server`, `next/headers`, `./config`
 * Flusso: La configurazione viene letta da middleware/layout/componenti per scegliere lingua e messaggi corretti.
 */

import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { defaultLocale, isLocale, localeCookieName } from './config'

type MessageValue = string | number | boolean | null | MessageObject | MessageValue[]
type MessageObject = { [key: string]: MessageValue }

/**
 * Merge profondo dei messaggi locale sopra i messaggi di default.
 * Mantiene fallback automatico per chiavi non ancora tradotte.
 */
function mergeMessages(base: MessageObject, override: MessageObject): MessageObject {
  const result: MessageObject = { ...base }

  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key]
    const bothObjects =
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)

    result[key] = bothObjects
      ? mergeMessages(baseValue as MessageObject, value as MessageObject)
      : value
  }

  return result
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const localeFromCookie = cookieStore.get(localeCookieName)?.value
  const locale = localeFromCookie && isLocale(localeFromCookie)
    ? localeFromCookie
    : defaultLocale
  const defaultMessages = (
    await import(`../../../messages/${defaultLocale}.json`)
  ).default as MessageObject
  const localeMessages = (
    await import(`../../../messages/${locale}.json`)
  ).default as MessageObject

  return {
    locale,
    messages: locale === defaultLocale
      ? defaultMessages
      : mergeMessages(defaultMessages, localeMessages),
  } as never
})
