import Link from "next/link";
import { redirect } from "next/navigation";
import { isSignupOpen } from "@/lib/auth";
import { getLocale, localeText } from "@/lib/i18n";
import { getOptionalUserContextFromHeaders } from "@/lib/user-context";

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: { error?: string; next?: string };
}) {
  const locale = getLocale();
  const [signupOpen, userContext] = await Promise.all([isSignupOpen(), getOptionalUserContextFromHeaders()]);

  if (userContext?.source === "session" || userContext?.source === "trusted_header") {
    redirect("/");
  }

  const next = sanitizeNext(searchParams?.next);

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="signup-heading">
        <div className="eyebrow">{localeText(locale, "账号体系", "Accounts")}</div>
        <h1 id="signup-heading">{localeText(locale, "创建 Sift 账号", "Create your Sift account")}</h1>
        <p>
          {localeText(
            locale,
            "第一个账号会自动认领当前本地单用户数据；之后保存的资料、模型配置和额度记录都会绑定到这个账号。",
            "The first account automatically claims the current local single-user data; future captures, model settings, and quota records are tied to this account.",
          )}
        </p>

        {searchParams?.error ? <p className="auth-error">{searchParams.error}</p> : null}

        {signupOpen ? (
          <form className="auth-form" action={`/api/auth/signup?next=${encodeURIComponent(next)}`} method="post">
            <label>
              {localeText(locale, "显示名称", "Display name")}
              <input autoComplete="name" name="displayName" placeholder={localeText(locale, "可选", "Optional")} type="text" />
            </label>
            <label>
              {localeText(locale, "邮箱", "Email")}
              <input autoComplete="email" name="email" required type="email" />
            </label>
            <label>
              {localeText(locale, "密码", "Password")}
              <input autoComplete="new-password" minLength={8} name="password" required type="password" />
            </label>
            <button className="button" type="submit">{localeText(locale, "创建账号", "Create account")}</button>
          </form>
        ) : (
          <p className="auth-error">
            {localeText(
              locale,
              "当前部署已创建过账号，公开注册已关闭。请使用已有账号登录。",
              "This deployment already has an account, so public signup is closed. Log in with an existing account.",
            )}
          </p>
        )}

        <p className="auth-switch">
          {localeText(locale, "已经有账号？", "Already have an account?")}{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`}>{localeText(locale, "登录", "Log in")}</Link>
        </p>
      </section>
    </main>
  );
}

function sanitizeNext(value: string | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
