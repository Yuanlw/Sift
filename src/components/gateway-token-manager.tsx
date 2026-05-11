"use client";

import { useEffect, useMemo, useState } from "react";
import type { GatewayTokenSummary } from "@/lib/gateway-tokens";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    title: "模型网关令牌与设备",
    body: "用于本地运行版连接 Sift 模型网关。令牌只在签发后显示一次；泄露、换设备或取消订阅时应吊销。",
    displayName: "名称",
    displayNamePlaceholder: "例如：MacBook 本地 Sift",
    installId: "设备标识",
    installIdPlaceholder: "可选，例如：yuan-macbook",
    expiresIn: "有效期",
    never: "不自动过期",
    days90: "90 天",
    days365: "365 天",
    issue: "签发令牌",
    issuing: "签发中",
    refresh: "刷新",
    loading: "正在加载令牌...",
    emptyTitle: "还没有模型网关令牌",
    emptyBody: "签发后，把令牌保存到服务端环境变量 SIFT_MODEL_GATEWAY_API_KEY。普通用户不需要接触底层模型供应商密钥。",
    newTokenTitle: "新令牌只显示这一次",
    newTokenBody: "关闭或刷新页面后只能看到前缀，不能再次查看完整令牌。",
    active: "可用",
    revoked: "已吊销",
    expires: "过期",
    noExpiry: "不过期",
    lastUsed: "最近使用",
    neverUsed: "未使用",
    revoke: "吊销",
    revoking: "吊销中",
    confirmRevoke: "确定吊销这个模型网关令牌吗？吊销后本地默认模型会停止通过它调用网关。",
    issueFailed: "签发失败。",
    loadFailed: "加载失败。",
    revokeFailed: "吊销失败。",
  },
  en: {
    title: "Gateway Tokens and Devices",
    body: "Use these for local Sift installs to access the Sift Model Gateway. A token is shown only once after issue; revoke it after leaks, device changes, or subscription cancellation.",
    displayName: "Name",
    displayNamePlaceholder: "For example: MacBook local Sift",
    installId: "Device ID",
    installIdPlaceholder: "Optional, for example: yuan-macbook",
    expiresIn: "Expires in",
    never: "No auto expiry",
    days90: "90 days",
    days365: "365 days",
    issue: "Issue token",
    issuing: "Issuing",
    refresh: "Refresh",
    loading: "Loading tokens...",
    emptyTitle: "No Gateway tokens yet",
    emptyBody: "After issue, store the token in the server-side SIFT_MODEL_GATEWAY_API_KEY environment variable. Regular users do not need provider API keys.",
    newTokenTitle: "New token is shown once",
    newTokenBody: "After closing or refreshing the page, only the prefix remains visible.",
    active: "Active",
    revoked: "Revoked",
    expires: "Expires",
    noExpiry: "No expiry",
    lastUsed: "Last used",
    neverUsed: "Never used",
    revoke: "Revoke",
    revoking: "Revoking",
    confirmRevoke: "Revoke this Gateway token? Local default models will stop using the gateway through this token.",
    issueFailed: "Issue failed.",
    loadFailed: "Load failed.",
    revokeFailed: "Revoke failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

type ExpiryChoice = "never" | "90" | "365";

export function GatewayTokenManager({ locale = "zh" }: { locale?: Locale }) {
  const t = copy[locale];
  const [tokens, setTokens] = useState<GatewayTokenSummary[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [installId, setInstallId] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>("never");
  const [plainToken, setPlainToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(t.loading);
  const [isLoading, setIsLoading] = useState(true);
  const [isIssuing, setIsIssuing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const activeTokens = useMemo(() => tokens.filter((token) => token.status === "active").length, [tokens]);

  useEffect(() => {
    void refreshTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshTokens() {
    setIsLoading(true);
    setStatus(t.loading);

    try {
      const response = await fetch("/api/gateway/tokens", { cache: "no-store" });
      const result = (await response.json().catch(() => null)) as { error?: string; tokens?: GatewayTokenSummary[] } | null;

      if (!response.ok) {
        throw new Error(result?.error || t.loadFailed);
      }

      setTokens(result?.tokens || []);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }

  async function issueToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isIssuing) return;

    setIsIssuing(true);
    setPlainToken(null);
    setStatus(null);

    try {
      const response = await fetch("/api/gateway/tokens", {
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          expiresAt: getExpiresAt(expiry),
          installId: installId.trim() || undefined,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string; token?: string; tokenRecord?: GatewayTokenSummary }
        | null;

      if (!response.ok || !result?.token || !result.tokenRecord) {
        throw new Error(result?.error || t.issueFailed);
      }

      setPlainToken(result.token);
      setTokens((current) => [result.tokenRecord!, ...current.filter((token) => token.id !== result.tokenRecord!.id)]);
      setDisplayName("");
      setInstallId("");
      setExpiry("never");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.issueFailed);
    } finally {
      setIsIssuing(false);
    }
  }

  async function revokeToken(tokenId: string) {
    if (revokingId || !window.confirm(t.confirmRevoke)) return;

    setRevokingId(tokenId);
    setStatus(null);

    try {
      const response = await fetch(`/api/gateway/tokens/${tokenId}/revoke`, {
        body: JSON.stringify({ reason: "revoked_from_settings" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string; tokenRecord?: GatewayTokenSummary }
        | null;

      if (!response.ok || !result?.tokenRecord) {
        throw new Error(result?.error || t.revokeFailed);
      }

      setTokens((current) => current.map((token) => (token.id === result.tokenRecord!.id ? result.tokenRecord! : token)));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.revokeFailed);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="gateway-token-manager">
      <div className="gateway-token-manager-heading">
        <div>
          <h3>{t.title}</h3>
          <p>{t.body}</p>
        </div>
        <button className="button button-secondary" disabled={isLoading} onClick={() => void refreshTokens()} type="button">
          {t.refresh}
        </button>
      </div>

      <form className="gateway-token-form" onSubmit={issueToken}>
        <label>
          {t.displayName}
          <input
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t.displayNamePlaceholder}
            type="text"
            value={displayName}
          />
        </label>
        <label>
          {t.installId}
          <input
            maxLength={120}
            onChange={(event) => setInstallId(event.target.value)}
            placeholder={t.installIdPlaceholder}
            type="text"
            value={installId}
          />
        </label>
        <label>
          {t.expiresIn}
          <select onChange={(event) => setExpiry(event.target.value as ExpiryChoice)} value={expiry}>
            <option value="never">{t.never}</option>
            <option value="90">{t.days90}</option>
            <option value="365">{t.days365}</option>
          </select>
        </label>
        <button className="button" disabled={isIssuing} type="submit">
          {isIssuing ? t.issuing : t.issue}
        </button>
      </form>

      {plainToken ? (
        <div className="gateway-token-secret">
          <div>
            <strong>{t.newTokenTitle}</strong>
            <p>{t.newTokenBody}</p>
          </div>
          <code>{plainToken}</code>
        </div>
      ) : null}

      {status ? <p className="settings-message settings-message-error">{status}</p> : null}

      {tokens.length > 0 ? (
        <div className="gateway-token-list" aria-live="polite">
          <div className="gateway-token-list-summary">
            <span>{activeTokens} {t.active}</span>
            <span>{tokens.length - activeTokens} {t.revoked}</span>
          </div>
          {tokens.map((token) => (
            <div className="gateway-token-row" key={token.id}>
              <div>
                <strong>{token.displayName}</strong>
                <span>{token.tokenPrefix}...</span>
                <small>
                  {token.installId || "-"} · {t.expires}: {token.expiresAt ? formatDate(token.expiresAt, locale) : t.noExpiry} ·{" "}
                  {t.lastUsed}: {token.lastUsedAt ? formatDate(token.lastUsedAt, locale) : t.neverUsed}
                </small>
              </div>
              <div className="gateway-token-row-actions">
                <span className={token.status === "active" ? "gateway-token-status-active" : "gateway-token-status-revoked"}>
                  {token.status === "active" ? t.active : t.revoked}
                </span>
                <button
                  className="button button-secondary"
                  disabled={token.status !== "active" || revokingId === token.id}
                  onClick={() => void revokeToken(token.id)}
                  type="button"
                >
                  {revokingId === token.id ? t.revoking : t.revoke}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : !isLoading ? (
        <div className="settings-empty">
          <h3>{t.emptyTitle}</h3>
          <p>{t.emptyBody}</p>
        </div>
      ) : null}
    </div>
  );
}

function getExpiresAt(choice: ExpiryChoice) {
  if (choice === "never") {
    return null;
  }

  const date = new Date();
  date.setDate(date.getDate() + Number(choice));
  return date.toISOString();
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
