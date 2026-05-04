import type { Metadata } from "next";
import Link from "next/link";
import { LanguageToggle } from "@/components/language-toggle";
import { getLocale, localeText } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sift",
  description: "Turn scattered captures into reusable knowledge.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = getLocale();

  return (
    <html lang={locale === "en" ? "en" : "zh-CN"}>
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              Sift
            </Link>
            <div className="topbar-actions">
              <nav className="nav" aria-label={localeText(locale, "主导航", "Primary navigation")}>
                <Link href="/inbox">{localeText(locale, "收集箱", "Inbox")}</Link>
                <Link href="/sources">{localeText(locale, "来源资料", "Sources")}</Link>
                <Link href="/wiki">{localeText(locale, "知识页", "Wiki")}</Link>
              </nav>
              <LanguageToggle locale={locale} />
            </div>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
