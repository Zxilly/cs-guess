import { t } from "@lingui/core/macro";
import { TranslateIcon } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  activateLocale,
  getActiveLocale,
  subscribeToLocale,
  type SupportedLocale,
} from "@/i18n";

const localeLabels: Record<SupportedLocale, string> = {
  "zh-CN": "中",
  en: "EN",
};

export function LanguageSwitcher() {
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getActiveLocale,
    getActiveLocale,
  );
  const nextLocale: SupportedLocale = locale === "zh-CN" ? "en" : "zh-CN";
  const nextLocaleName = nextLocale === "en" ? t`英文` : t`中文`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="rounded-none"
      aria-label={t`切换为${nextLocaleName}`}
      title={t`切换为${nextLocaleName}`}
      onClick={() => {
        activateLocale(nextLocale, { persist: true });
        window.location.reload();
      }}
    >
      <TranslateIcon />
      <span className="sr-only">{localeLabels[locale]}</span>
    </Button>
  );
}
