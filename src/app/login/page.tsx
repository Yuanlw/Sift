import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, localeText } from "@/lib/i18n";
import { getOptionalUserContextFromHeaders } from "@/lib/user-context";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string; next?: string };
}) {
  const locale = getLocale();
  const userContext = await getOptionalUserContextFromHeaders();

  if (userContext?.source === "session" || userContext?.source === "trusted_header") {
    redirect("/");
  }

  const next = sanitizeNext(searchParams?.next);

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="login-heading">
        <div className="eyebrow">{localeText(locale, "欢迎回来", "Welcome back")}</div>
        <h1 id="login-heading">{localeText(locale, "登录 Sift", "Log in to Sift")}</h1>
        <p>
          {localeText(
            locale,
            "登录后继续使用你的收集箱、来源资料、知识页、模型配置和额度记录。",
            "Log in to continue with your inbox, sources, wiki pages, model settings, and quota history.",
          )}
        </p>

        {searchParams?.error ? <p className="auth-error">{searchParams.error}</p> : null}

        <form className="auth-form" action={`/api/auth/login?next=${encodeURIComponent(next)}`} method="post">
          <label>
            {localeText(locale, "邮箱", "Email")}
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            {localeText(locale, "密码", "Password")}
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          <button className="button" type="submit">{localeText(locale, "登录", "Log in")}</button>
        </form>

        <p className="auth-switch">
          {localeText(locale, "还没有账号？", "No account yet?")}{" "}
          <Link href={`/signup?next=${encodeURIComponent(next)}`}>{localeText(locale, "创建第一个账号", "Create an account")}</Link>
        </p>
      </section>
    </main>
  );
}

function sanitizeNext(value: string | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
