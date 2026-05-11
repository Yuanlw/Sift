import type { Metadata } from "next";
import Link from "next/link";
import { LanguageToggle } from "@/components/language-toggle";
import { MainNav } from "@/components/main-nav";
import { isSupportAdminEmail } from "@/lib/admin-auth";
import { getLocale, localeText } from "@/lib/i18n";
import { getOptionalUserContextFromHeaders } from "@/lib/user-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sift",
  description: "Turn scattered captures into reusable knowledge.",
  manifest: "/manifest.webmanifest",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = getLocale();
  const userContext = await getOptionalUserContextFromHeaders();
  const accountLabel = userContext?.email
    ? userContext.email
    : localeText(locale, "登录", "Log in");
  const showAdmin = isSupportAdminEmail(userContext?.email);

  return (
    <html lang={locale === "en" ? "en" : "zh-CN"}>
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark">S</span>
              <span>Sift</span>
            </Link>
            <div className="topbar-actions">
              <MainNav locale={locale} showAdmin={showAdmin} />
              <LanguageToggle locale={locale} />
              <Link className="account-pill" href={userContext?.email ? "/settings" : "/login"}>
                <span className="account-dot" />
                {accountLabel}
              </Link>
            </div>
          </header>
          <main className="main">{children}</main>
          <footer className="site-footer">
            <div>
              <strong>Sift</strong>
              <span>{localeText(locale, "先保存、再沉淀的个人知识库。", "Capture-first personal knowledge base.")}</span>
            </div>
            <nav aria-label={localeText(locale, "页脚导航", "Footer navigation")}>
              <Link href="/pricing">{localeText(locale, "价格", "Pricing")}</Link>
              <Link href="/contact">{localeText(locale, "联系我们", "Contact Us")}</Link>
              <Link href="/privacy">{localeText(locale, "隐私政策", "Privacy Policy")}</Link>
              <Link href="/terms">{localeText(locale, "服务条款", "Terms of Service")}</Link>
              <Link href="/refund">{localeText(locale, "退款政策", "Refund Policy")}</Link>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  );
}
