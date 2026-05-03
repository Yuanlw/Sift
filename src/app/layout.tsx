import type { Metadata } from "next";
import Link from "next/link";
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
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              Sift
            </Link>
            <nav className="nav" aria-label="Primary navigation">
              <Link href="/inbox">Inbox</Link>
              <Link href="/sources">Sources</Link>
              <Link href="/wiki">Wiki</Link>
            </nav>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
