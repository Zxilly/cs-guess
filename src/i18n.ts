import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

import { messages as enMessages } from "@/locales/en/messages.po";
import { messages as zhCnMessages } from "@/locales/zh-CN/messages.po";

export const supportedLocales = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const fallbackLocale: SupportedLocale = "en";
export const localeStorageKey = "cs-guess:locale";

i18n.load({
  "zh-CN": zhCnMessages,
  en: enMessages,
});

// Keep direct component tests and non-browser consumers deterministic. The app
// activates the negotiated locale before its first render.
i18n.activate("zh-CN");

export { i18n };

export function matchSupportedLocale(
  languageTags: readonly string[],
): SupportedLocale {
  for (const tag of languageTags) {
    const normalized = tag.trim().toLowerCase();
    if (normalized === "zh" || normalized.startsWith("zh-")) {
      return "zh-CN";
    }
    if (normalized === "en" || normalized.startsWith("en-")) {
      return "en";
    }
  }

  return fallbackLocale;
}

export function readPreferredLocale(): SupportedLocale | null {
  try {
    const stored = window.localStorage.getItem(localeStorageKey);
    return supportedLocales.includes(stored as SupportedLocale)
      ? (stored as SupportedLocale)
      : null;
  } catch {
    return null;
  }
}

export function detectInitialLocale(): SupportedLocale {
  const stored = readPreferredLocale();
  if (stored) return stored;

  const languageTags = navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : [];
  return matchSupportedLocale(languageTags);
}

function syncDocumentLocale(locale: SupportedLocale) {
  document.documentElement.lang = locale;
  document.title = t`CS Guess — 每日选手竞猜`;

  const description = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]',
  );
  description?.setAttribute(
    "content",
    t`CS Guess — 每日 Counter-Strike 职业选手竞猜挑战`,
  );
}

export function activateLocale(
  locale: SupportedLocale,
  options: { persist?: boolean } = {},
) {
  i18n.activate(locale);

  if (typeof document !== "undefined") {
    syncDocumentLocale(locale);
  }

  if (options.persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(localeStorageKey, locale);
    } catch {
      // Language switching should still work when storage is unavailable.
    }
  }
}

export function initializeLocale(): SupportedLocale {
  const locale = detectInitialLocale();
  activateLocale(locale);
  return locale;
}

export function subscribeToLocale(onChange: () => void) {
  return i18n.on("change", onChange);
}

export function getActiveLocale(): SupportedLocale {
  return supportedLocales.includes(i18n.locale as SupportedLocale)
    ? (i18n.locale as SupportedLocale)
    : fallbackLocale;
}
