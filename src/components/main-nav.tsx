"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Locale = "zh" | "en";

const navItems = [
  { href: "/", label: { zh: "首页", en: "Home" } },
  { href: "/inbox", label: { zh: "收集箱", en: "Inbox" } },
  { href: "/sources", label: { zh: "来源资料", en: "Sources" } },
  { href: "/wiki", label: { zh: "知识页", en: "Wiki" } },
] as const;

export function MainNav({ locale }: { locale: Locale }) {
  const pathname = usePathname() || "/";

  return (
    <nav className="nav" aria-label={t(locale, "主导航", "Primary navigation")}>
      {navItems.map((item) => {
        const active = isActivePath(pathname, item.href);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "is-active" : undefined}
            href={item.href}
            key={item.href}
          >
            {t(locale, item.label.zh, item.label.en)}
          </Link>
        );
      })}
    </nav>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function t(locale: Locale, zh: string, en: string) {
  return locale === "en" ? en : zh;
}
