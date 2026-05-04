import { cookies } from "next/headers";

export type Locale = "zh" | "en";

export function getLocale(): Locale {
  const value = cookies().get("sift_locale")?.value;
  return value === "en" ? "en" : "zh";
}

export function localeText<T>(locale: Locale, zh: T, en: T) {
  return locale === "en" ? en : zh;
}

export function formatDateTime(value: string, locale: Locale, withYear = false) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    year: withYear ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
