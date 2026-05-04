"use client";

import type { Locale } from "@/lib/i18n";

export function LanguageToggle({ locale }: { locale: Locale }) {
  function switchLocale(nextLocale: Locale) {
    document.cookie = `sift_locale=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div className="language-toggle" aria-label={locale === "en" ? "Language" : "语言"}>
      <button
        aria-pressed={locale === "zh"}
        className={locale === "zh" ? "is-active" : ""}
        onClick={() => switchLocale("zh")}
        type="button"
      >
        中文
      </button>
      <button
        aria-pressed={locale === "en"}
        className={locale === "en" ? "is-active" : ""}
        onClick={() => switchLocale("en")}
        type="button"
      >
        English
      </button>
    </div>
  );
}
