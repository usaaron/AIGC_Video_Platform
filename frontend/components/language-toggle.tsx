"use client";

import { useLocale } from "@/providers/locale-provider";

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div aria-label={t("language.label")} className={`language-toggle ${compact ? "is-compact" : ""}`} role="group">
      <button aria-pressed={locale === "en"} onClick={() => setLocale("en")} title="English interface" type="button">EN</button>
      <button aria-pressed={locale === "zh"} onClick={() => setLocale("zh")} title="切换为中文界面" type="button">中文</button>
    </div>
  );
}
