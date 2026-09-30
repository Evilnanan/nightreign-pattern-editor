import { IntlMessageFormat } from "intl-messageformat";
import english from "./locales/en.json";
import chinese from "./locales/zh-CN.json";
import type { LocalizedMessage, MessageArguments, MessageKey } from "./locales/messages";

export type { LocalizedMessage, MessageKey } from "./locales/messages";
export const supportedLanguages = ["en", "zh-CN"] as const;
export type Language = typeof supportedLanguages[number];
export type StatusMessage = LocalizedMessage | null;
const defaultLanguage: Language = "en";
const catalogs: Record<Language, Partial<Record<MessageKey, string>>> = { en: english, "zh-CN": chinese };
const storageKey = "nightreign-map-language";
const listeners = new Set<(language: Language) => void>();
const formatters = new Map<string, IntlMessageFormat>();
let language: Language = defaultLanguage;

try {
  const saved = localStorage.getItem(storageKey);
  if (supportedLanguages.includes(saved as Language)) language = saved as Language;
} catch { /* Browser storage is optional. */ }

export function getLanguage() { return language; }

export function setLanguage(next: Language) {
  if (!supportedLanguages.includes(next)) throw new Error(`Unsupported language: ${next}`);
  if (next === language) return;
  language = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the selection for this session. */ }
  for (const listener of listeners) listener(next);
}

export function subscribeLanguage(listener: (language: Language) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function message<K extends MessageKey>(...args: MessageArguments<K>): LocalizedMessage {
  return { key: args[0], values: args[1] } as LocalizedMessage;
}

export function formatMessage(descriptor: StatusMessage, requestedLanguage: Language = language): string {
  if (!descriptor) return "";
  const translated = catalogs[requestedLanguage][descriptor.key];
  const locale = translated === undefined ? defaultLanguage : requestedLanguage;
  const text = translated ?? catalogs.en[descriptor.key];
  if (text === undefined) throw new Error(`Unknown message key: ${descriptor.key}`);
  const cacheKey = `${locale}:${descriptor.key}`;
  let formatter = formatters.get(cacheKey);
  if (!formatter) {
    formatter = new IntlMessageFormat(text, locale, undefined, { ignoreTag: true });
    formatters.set(cacheKey, formatter);
  }
  const values: Record<string, string | number | Date> = {};
  for (const [name, value] of Object.entries(descriptor.values ?? {})) {
    values[name] = typeof value === "object" && value !== null && "key" in value
      ? formatMessage(value, locale) : value;
  }
  const formatted = formatter.format(values);
  if (typeof formatted !== "string") throw new Error(`Message ${descriptor.key} must format as text`);
  return formatted;
}

export function t<K extends MessageKey>(...args: MessageArguments<K>): string {
  return formatMessage(message<K>(...args));
}

export class LocalizedError extends Error {
  constructor(readonly descriptor: LocalizedMessage) {
    super(descriptor.key);
    this.name = "LocalizedError";
  }
}

export function errorMessage(error: unknown): LocalizedMessage {
  if (error instanceof LocalizedError) return error.descriptor;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" &&
      error.code.startsWith("errors.") && Object.hasOwn(english, error.code)) {
    const params = "params" in error ? error.params : {};
    if (typeof params === "object" && params !== null &&
        Object.values(params).every(value => typeof value === "string" || typeof value === "number")) {
      const descriptor = { key: error.code, values: params } as LocalizedMessage;
      try {
        formatMessage(descriptor, defaultLanguage);
        if ("details" in error) console.error(`[${error.code}]`, error.details);
        return descriptor;
      } catch { /* Invalid external error payloads use the generic message. */ }
    }
  }
  console.error("Unexpected application error", error);
  return message("errors.unexpected");
}

// Entity names belong to the dataset, separately from application messages.
export function localizedName(named: { name: string; nameZh?: string | null }): string {
  return language === "zh-CN" ? named.nameZh?.trim() || named.name : named.name;
}
