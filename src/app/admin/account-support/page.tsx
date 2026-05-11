import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { requireSupportAdmin } from "@/lib/admin-auth";
import { normalizeEmail } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, getLocale, localeText, type Locale } from "@/lib/i18n";

interface UserRow {
  created_at: string;
  display_name: string | null;
  email: string;
  id: string;
  last_login_at: string | null;
}

interface QuotaRow {
  enforcement_mode: string;
  monthly_credit_limit: number | null;
  plan_code: string;
  quota_source: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  updated_at: string;
}

interface QuotaUsageRow {
  category: string;
  credits: string | null;
}

interface GatewayTokenRow {
  created_at: string;
  display_name: string;
  expires_at: string | null;
  id: string;
  install_id: string | null;
  last_used_at: string | null;
  plan_code: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  status: string;
  token_prefix: string;
}

interface GatewayIncidentRow {
  created_at: string;
  credits: number;
  display_name: string | null;
  error_code: string | null;
  install_id: string | null;
  metadata: Record<string, unknown>;
  model_role: string;
  purpose: string;
  request_count: number;
  status: string;
  token_prefix: string | null;
}

interface GatewayStatusAggregateRow {
  credits: string | null;
  requests: string;
  status: string;
}

interface UsageCountRow {
  captures: string;
  last_capture_at: string | null;
  sources: string;
  wiki_pages: string;
}

interface SupportNoteRow {
  admin_email: string | null;
  contact_status: string;
  created_at: string;
  id: string;
  issue_type: string;
  note: string;
}

interface SupportCase {
  gatewayAggregates: GatewayStatusAggregateRow[];
  gatewayIncidents: GatewayIncidentRow[];
  productUsage: UsageCountRow | null;
  quota: QuotaRow | null;
  quotaUsage: QuotaUsageRow[];
  schemaWarnings: string[];
  supportNotes: SupportNoteRow[];
  tokens: GatewayTokenRow[];
  user: UserRow | null;
}

export default async function AccountSupportPage({
  searchParams,
}: {
  searchParams?: { email?: string };
}) {
  noStore();

  await requireSupportAdmin("/admin/account-support");

  const locale = getLocale();
  const email = normalizeSearchEmail(searchParams?.email);
  const supportCase = email ? await loadSupportCase(email) : null;

  return (
    <div className="admin-page">
      <section className="hero settings-hero">
        <div className="eyebrow">{localeText(locale, "运营后台", "Admin")}</div>
        <h1>{localeText(locale, "账号支持台", "Account Support")}</h1>
        <p>
          {localeText(
            locale,
            "按邮箱查询一个用户的订阅、额度、模型网关令牌和最近网关拒绝原因，并记录客服处理结果。这里不签发套餐、不修改额度、不展示完整令牌。",
            "Look up one account by email for subscription, quota, Gateway tokens, and recent gateway rejection reasons, then record support handling. This console does not edit plans, edit quota, or show full tokens.",
          )}
        </p>
      </section>

      <section className="settings-section admin-search-panel" aria-labelledby="admin-search-heading">
        <div className="admin-search-copy">
          <h2 id="admin-search-heading">{localeText(locale, "查询用户", "Find Account")}</h2>
          <p>{localeText(locale, "输入注册邮箱。只有管理员白名单内的登录账号可以访问。", "Enter a registered email. Only signed-in admin accounts can access this page.")}</p>
        </div>
        <div className="admin-search-controls">
          <form className="admin-search-form" method="get">
            <input
              autoComplete="email"
              defaultValue={email}
              name="email"
              placeholder={localeText(locale, "user@example.com", "user@example.com")}
              required
              type="email"
            />
            <button className="button" type="submit">{localeText(locale, "查询", "Lookup")}</button>
          </form>
          <div className="admin-search-actions">
            <Link className="button button-secondary" href={email ? `/admin/refunds?email=${encodeURIComponent(email)}` : "/admin/refunds"}>
              {localeText(locale, "人工退款", "Manual refunds")}
            </Link>
            <Link className="button button-secondary" href="/admin/retention">
              {localeText(locale, "留存看板", "Retention")}
            </Link>
          </div>
        </div>
      </section>

      {supportCase ? <SupportCaseView email={email} locale={locale} supportCase={supportCase} /> : null}
    </div>
  );
}

function SupportCaseView({
  email,
  locale,
  supportCase,
}: {
  email: string;
  locale: Locale;
  supportCase: SupportCase;
}) {
  if (!supportCase.user) {
    return (
      <section className="settings-section">
        <div className="settings-empty">
          <strong>{localeText(locale, "没有找到账号", "No account found")}</strong>
          <p>{localeText(locale, `邮箱 ${email} 不存在。`, `No user exists for ${email}.`)}</p>
        </div>
      </section>
    );
  }

  const usedCredits = supportCase.quotaUsage.reduce((sum, row) => sum + toNumber(row.credits), 0);
  const remaining =
    supportCase.quota?.monthly_credit_limit === null || !supportCase.quota
      ? null
      : Math.max(0, supportCase.quota.monthly_credit_limit - usedCredits);
  const activeTokens = supportCase.tokens.filter((token) => token.status === "active").length;
  const rejected = supportCase.gatewayAggregates.find((row) => row.status === "rejected");

  return (
    <>
      {supportCase.schemaWarnings.length > 0 ? (
        <section className="settings-section">
          <div className="settings-message settings-message-error">
            {localeText(locale, "部分订阅或模型网关表尚未迁移：", "Some subscription or Gateway tables are not migrated: ")}
            {supportCase.schemaWarnings.join(", ")}
          </div>
        </section>
      ) : null}

      <section className="settings-section admin-case-summary" aria-label={localeText(locale, "账号摘要", "Account summary")}>
        <div className="settings-kv-grid">
          <KeyValue label={localeText(locale, "邮箱", "Email")} value={supportCase.user.email} />
          <KeyValue label={localeText(locale, "用户", "User")} value={shortId(supportCase.user.id)} />
          <KeyValue label={localeText(locale, "套餐", "Plan")} value={formatPlanCode(supportCase.quota?.plan_code || null, locale)} />
          <KeyValue label={localeText(locale, "订阅状态", "Subscription")} value={formatQuotaSummaryStatus(supportCase.quota, locale)} />
          <KeyValue label={localeText(locale, "本期已用", "Used")} value={formatNumber(usedCredits, locale)} />
          <KeyValue label={localeText(locale, "剩余额度", "Remaining")} value={remaining === null ? localeText(locale, "不限制/未知", "Unlimited/unknown") : formatNumber(remaining, locale)} />
          <KeyValue label={localeText(locale, "可用令牌", "Active tokens")} value={formatNumber(activeTokens, locale)} />
          <KeyValue label={localeText(locale, "最近拒绝", "Recent rejections")} value={formatNumber(toNumber(rejected?.requests), locale)} tone={rejected ? "warning" : "ok"} />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>{localeText(locale, "客服处理记录", "Support Handling")}</h2>
              <p>{localeText(locale, "记录问题类型、联系状态和处理备注，方便后续接手。", "Record issue type, contact status, and handling notes so the next operator can pick up the case.")}</p>
          </div>
        </div>
        <div className="admin-support-note-grid">
          <form action="/api/admin/support-notes" className="admin-support-note-form" method="post">
            <input name="userEmail" type="hidden" value={supportCase.user.email} />
            <label>
              {localeText(locale, "问题类型", "Issue type")}
              <select name="issueType" required>
                <option value="billing">{localeText(locale, "计费/订阅", "Billing")}</option>
                <option value="refund">{localeText(locale, "退款", "Refund")}</option>
                <option value="gateway">{localeText(locale, "模型网关/令牌", "Gateway/token")}</option>
                <option value="quota">{localeText(locale, "额度", "Quota")}</option>
                <option value="login">{localeText(locale, "登录/账号", "Login/account")}</option>
                <option value="product">{localeText(locale, "产品使用", "Product")}</option>
                <option value="other">{localeText(locale, "其他", "Other")}</option>
              </select>
            </label>
            <label>
              {localeText(locale, "联系状态", "Contact status")}
              <select name="contactStatus" required>
                <option value="not_contacted">{localeText(locale, "未联系", "Not contacted")}</option>
                <option value="contacted">{localeText(locale, "已联系", "Contacted")}</option>
                <option value="waiting_user">{localeText(locale, "等待用户", "Waiting for user")}</option>
                <option value="resolved">{localeText(locale, "已解决", "Resolved")}</option>
              </select>
            </label>
            <label className="admin-support-note-form-wide">
              {localeText(locale, "处理备注", "Handling note")}
              <textarea name="note" required rows={3} />
            </label>
            <button className="button" type="submit">{localeText(locale, "记录处理结果", "Save handling note")}</button>
          </form>
          <div className="admin-support-note-list">
            {supportCase.supportNotes.length > 0 ? (
              supportCase.supportNotes.map((note) => (
                <article className="admin-support-note" key={note.id}>
                  <div>
                    <strong>{getIssueTypeLabel(note.issue_type, locale)}</strong>
                    <span>{getContactStatusLabel(note.contact_status, locale)}</span>
                  </div>
                  <p>{note.note}</p>
                  <small>
                    {formatDateTime(note.created_at, locale, true)}
                    {note.admin_email ? ` · ${note.admin_email}` : ""}
                  </small>
                </article>
              ))
            ) : (
              <div className="settings-empty">
                <p>{localeText(locale, "还没有客服处理记录。", "No support handling notes yet.")}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="admin-case-grid">
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>{localeText(locale, "订阅与额度", "Subscription and Quota")}</h2>
            <p>{localeText(locale, "支付事实仍以支付系统为准；这里展示 Sift 同步后的状态和本期额度账本。", "Stripe remains the payment source of truth; this shows the state and quota ledger synced into Sift.")}</p>
          </div>
        </div>
        <div className="admin-support-activation">
          <form action="/api/admin/manual-activations" className="admin-support-note-form" method="post">
            <input name="userEmail" type="hidden" value={supportCase.user.email} />
            <label>
              {localeText(locale, "手动套餐", "Manual plan")}
              <select defaultValue={supportCase.quota?.plan_code || "personal"} name="planCode">
                <option value="personal">{localeText(locale, "个人版", "Personal")}</option>
                <option value="pro">{localeText(locale, "专业版", "Pro")}</option>
                <option value="team">{localeText(locale, "团队版", "Team")}</option>
                <option value="local">{localeText(locale, "本地测试", "Local")}</option>
              </select>
            </label>
            <label>
              {localeText(locale, "月度额度", "Monthly credit limit")}
              <input
                defaultValue={supportCase.quota?.monthly_credit_limit ?? ""}
                name="monthlyCreditLimit"
                placeholder={localeText(locale, "留空表示不限额", "Leave blank for unlimited")}
                type="number"
                min="1"
                step="1"
              />
            </label>
            <button className="button" type="submit">{localeText(locale, "手动开通/更新", "Apply manual activation")}</button>
          </form>
          <div className="settings-note">
            <strong>{localeText(locale, "当前来源", "Current source")}</strong>
            <p>{formatQuotaSummaryStatus(supportCase.quota, locale)}</p>
          </div>
        </div>
        <div className="settings-note-grid settings-note-grid-compact">
          <div className="settings-note">
            <strong>{localeText(locale, "订阅", "Subscription")}</strong>
            <p>{formatQuotaAccount(supportCase.quota, locale)}</p>
          </div>
          <div className="settings-note">
            <strong>{localeText(locale, "产品使用", "Product Usage")}</strong>
            <p>{formatProductUsage(supportCase.productUsage, locale)}</p>
          </div>
          </div>
          <AdminTable
            emptyText={localeText(locale, "本期还没有智能额度消耗。", "No smart quota usage this period.")}
            headers={[localeText(locale, "类别", "Category"), localeText(locale, "额度", "Credits")]}
            rows={supportCase.quotaUsage.map((row) => [formatQuotaCategory(row.category, locale), formatNumber(toNumber(row.credits), locale)])}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>{localeText(locale, "模型网关令牌", "Gateway Tokens")}</h2>
              <p>{localeText(locale, "只显示前缀和设备标识，不显示完整令牌或哈希。", "Only prefixes and install ids are shown; full tokens and hashes are never displayed.")}</p>
            </div>
          </div>
          <AdminTable
            emptyText={localeText(locale, "还没有令牌。", "No tokens yet.")}
            headers={[
              localeText(locale, "名称", "Name"),
              localeText(locale, "前缀", "Prefix"),
              localeText(locale, "状态", "Status"),
              localeText(locale, "设备", "Install"),
              localeText(locale, "最近使用", "Last used"),
            ]}
            rows={supportCase.tokens.map((token) => [
              token.display_name,
              `${token.token_prefix}...`,
              getTokenStatusLabel(token.status, locale),
              token.install_id || "-",
              token.last_used_at ? formatDateTime(token.last_used_at, locale, true) : "-",
            ])}
          />
          <div className="admin-token-actions">
            {supportCase.tokens.map((token) =>
              token.status === "active" ? (
                <form action={`/api/admin/gateway-tokens/${token.id}/revoke`} className="admin-token-action" key={token.id} method="post">
                  <span>{token.display_name}</span>
                  <button className="button button-secondary" type="submit">{localeText(locale, "吊销令牌", "Revoke token")}</button>
                </form>
              ) : null,
            )}
          </div>
        </section>
      </div>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>{localeText(locale, "最近网关拒绝/失败", "Recent Gateway Rejections and Failures")}</h2>
            <p>{localeText(locale, "用于判断是否因为订阅失效、额度不足、频率限制、令牌吊销或单次请求过大导致模型能力不可用。", "Use this to identify inactive subscriptions, quota exhaustion, rate limits, revoked tokens, or oversized requests.")}</p>
          </div>
        </div>
        <AdminTable
          emptyText={localeText(locale, "最近没有网关拒绝或失败。", "No recent Gateway rejections or failures.")}
          headers={[
            localeText(locale, "时间", "Time"),
            localeText(locale, "状态", "Status"),
            localeText(locale, "原因", "Reason"),
            localeText(locale, "用途", "Purpose"),
            localeText(locale, "令牌", "Token"),
            localeText(locale, "额度", "Credits"),
          ]}
          rows={supportCase.gatewayIncidents.map((incident) => [
            formatDateTime(incident.created_at, locale, true),
            getGatewayStatusLabel(incident.status, locale),
            incident.error_code || getMetadataReason(incident.metadata),
            formatPurpose(incident.purpose, locale),
            incident.token_prefix ? `${incident.token_prefix}...` : "-",
            formatNumber(incident.credits, locale),
          ])}
        />
      </section>
    </>
  );
}

async function loadSupportCase(email: string): Promise<SupportCase> {
  const user = await loadUser(email);

  if (!user) {
    return {
      gatewayAggregates: [],
      gatewayIncidents: [],
      productUsage: null,
      quota: null,
      quotaUsage: [],
      schemaWarnings: [],
      supportNotes: [],
      tokens: [],
      user: null,
    };
  }

  const schemaWarnings: string[] = [];
  const [quota, quotaUsage, tokens, gatewayAggregates, gatewayIncidents, productUsage, supportNotes] = await Promise.all([
    loadOptional("smart_quota_accounts", () => loadQuota(user.id), schemaWarnings),
    loadOptional("smart_quota_ledger", () => loadQuotaUsage(user.id), schemaWarnings),
    loadOptional("sift_gateway_tokens", () => loadGatewayTokens(user.id), schemaWarnings),
    loadOptional("sift_gateway_usage_ledger", () => loadGatewayAggregates(user.id), schemaWarnings),
    loadOptional("sift_gateway_usage_ledger", () => loadGatewayIncidents(user.id), schemaWarnings),
    loadProductUsage(user.id),
    loadOptional("support_case_notes", () => loadSupportNotes(user.id), schemaWarnings),
  ]);

  return {
    gatewayAggregates: gatewayAggregates || [],
    gatewayIncidents: gatewayIncidents || [],
    productUsage,
    quota,
    quotaUsage: quotaUsage || [],
    schemaWarnings: Array.from(new Set(schemaWarnings)),
    supportNotes: supportNotes || [],
    tokens: tokens || [],
    user,
  };
}

async function loadUser(email: string) {
  const { rows } = await query<UserRow>(
    `
      select id, email, display_name, last_login_at::text, created_at::text
      from users
      where email = $1
      limit 1
    `,
    [email],
  );

  return rows[0] || null;
}

async function loadQuota(userId: string) {
  const { rows } = await query<QuotaRow>(
    `
      select
        plan_code,
        enforcement_mode,
        monthly_credit_limit,
        quota_source,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_subscription_status,
        updated_at::text
      from smart_quota_accounts
      where user_id = $1
      limit 1
    `,
    [userId],
  );

  return rows[0] || null;
}

async function loadQuotaUsage(userId: string) {
  const { rows } = await query<QuotaUsageRow>(
    `
      select category, coalesce(sum(credits), 0)::text as credits
      from smart_quota_ledger
      where user_id = $1
        and created_at >= date_trunc('month', now())
      group by category
      order by category
    `,
    [userId],
  );

  return rows;
}

async function loadGatewayTokens(userId: string) {
  const { rows } = await query<GatewayTokenRow>(
    `
      select
        id,
        token_prefix,
        display_name,
        install_id,
        status,
        plan_code,
        expires_at::text,
        last_used_at::text,
        revoked_at::text,
        revoked_reason,
        created_at::text
      from sift_gateway_tokens
      where user_id = $1
      order by created_at desc
      limit 20
    `,
    [userId],
  );

  return rows;
}

async function loadGatewayAggregates(userId: string) {
  const { rows } = await query<GatewayStatusAggregateRow>(
    `
      select status, count(*)::text as requests, coalesce(sum(credits), 0)::text as credits
      from sift_gateway_usage_ledger
      where user_id = $1
        and created_at >= now() - interval '30 days'
      group by status
      order by status
    `,
    [userId],
  );

  return rows;
}

async function loadGatewayIncidents(userId: string) {
  const { rows } = await query<GatewayIncidentRow>(
    `
      select
        usage.created_at::text,
        usage.status,
        usage.error_code,
        usage.purpose,
        usage.model_role,
        usage.request_count,
        usage.credits,
        usage.metadata,
        tokens.token_prefix,
        tokens.display_name,
        tokens.install_id
      from sift_gateway_usage_ledger usage
      left join sift_gateway_tokens tokens on tokens.id = usage.token_id
      where usage.user_id = $1
        and usage.status in ('rejected', 'failure')
      order by usage.created_at desc
      limit 12
    `,
    [userId],
  );

  return rows;
}

async function loadProductUsage(userId: string) {
  const { rows } = await query<UsageCountRow>(
    `
      select
        (select count(*)::text from captures where user_id = $1) as captures,
        (select max(created_at)::text from captures where user_id = $1) as last_capture_at,
        (select count(*)::text from sources where user_id = $1) as sources,
        (select count(*)::text from wiki_pages where user_id = $1) as wiki_pages
    `,
    [userId],
  );

  return rows[0] || null;
}

async function loadSupportNotes(userId: string) {
  const { rows } = await query<SupportNoteRow>(
    `
      select
        notes.id,
        notes.issue_type,
        notes.contact_status,
        notes.note,
        notes.created_at::text,
        admins.email as admin_email
      from support_case_notes notes
      left join users admins on admins.id = notes.admin_user_id
      where notes.user_id = $1
      order by notes.created_at desc
      limit 12
    `,
    [userId],
  );

  return rows;
}

async function loadOptional<T>(label: string, loader: () => Promise<T>, schemaWarnings: string[]) {
  try {
    return await loader();
  } catch (error) {
    if (isMissingRelationError(error)) {
      schemaWarnings.push(label);
      return null;
    }

    throw error;
  }
}

function AdminTable({
  emptyText,
  headers,
  rows,
}: {
  emptyText: string;
  headers: string[];
  rows: string[][];
}) {
  if (rows.length === 0) {
    return (
      <div className="settings-empty">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="settings-table-wrap">
      <table className="settings-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${row.join("|")}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cellIndex}-${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValue({
  label,
  tone = "muted",
  value,
}: {
  label: string;
  tone?: "muted" | "ok" | "warning";
  value: string;
}) {
  return (
    <div className="settings-kv">
      <span>{label}</span>
      <strong className={`settings-value-${tone}`}>{value}</strong>
    </div>
  );
}

function formatQuotaAccount(quota: QuotaRow | null, locale: Locale) {
  if (!quota) {
    return localeText(locale, "没有额度账号记录，可能还未完成迁移或从未触发默认模型。", "No quota account record; migrations may be missing or default models were never used.");
  }

  if (locale === "zh") {
    return [
      `套餐：${formatPlanCode(quota.plan_code, locale)}`,
      `来源：${formatQuotaSource(quota.quota_source, locale)}`,
      `限制：${formatEnforcementMode(quota.enforcement_mode, locale)}`,
      `支付状态：${formatSubscriptionStatus(quota.stripe_subscription_status, locale)}`,
    ].join("；");
  }

  return [
    formatPlanCode(quota.plan_code, locale),
    formatQuotaSource(quota.quota_source, locale),
    formatEnforcementMode(quota.enforcement_mode, locale),
    formatSubscriptionStatus(quota.stripe_subscription_status, locale),
  ].join(" / ");
}

function formatProductUsage(usage: UsageCountRow | null, locale: Locale) {
  if (!usage) {
    return "-";
  }

  const lastCapture = usage.last_capture_at ? formatDateTime(usage.last_capture_at, locale, true) : localeText(locale, "无", "none");
  return localeText(
    locale,
    `保存 ${usage.captures} 条，来源 ${usage.sources} 条，知识页 ${usage.wiki_pages} 条；最近保存：${lastCapture}`,
    `${usage.captures} captures, ${usage.sources} sources, ${usage.wiki_pages} wiki pages; last capture: ${lastCapture}`,
  );
}

function getMetadataReason(metadata: Record<string, unknown>) {
  const reason = metadata.reason || metadata.error || metadata.code;
  return typeof reason === "string" && reason ? reason : "-";
}

function getIssueTypeLabel(value: string, locale: Locale) {
  const labels: Record<string, string> = {
    billing: localeText(locale, "计费/订阅", "Billing"),
    gateway: localeText(locale, "模型网关/令牌", "Gateway/token"),
    login: localeText(locale, "登录/账号", "Login/account"),
    other: localeText(locale, "其他", "Other"),
    product: localeText(locale, "产品使用", "Product"),
    quota: localeText(locale, "额度", "Quota"),
    refund: localeText(locale, "退款", "Refund"),
  };

  return labels[value] || value;
}

function getContactStatusLabel(value: string, locale: Locale) {
  const labels: Record<string, string> = {
    contacted: localeText(locale, "已联系", "Contacted"),
    not_contacted: localeText(locale, "未联系", "Not contacted"),
    resolved: localeText(locale, "已解决", "Resolved"),
    waiting_user: localeText(locale, "等待用户", "Waiting for user"),
  };

  return labels[value] || value;
}

function normalizeSearchEmail(value: string | undefined) {
  return value ? normalizeEmail(value) : "";
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(value);
}

function formatQuotaCategory(value: string, locale: Locale) {
  const labels: Record<string, string> = {
    ask: localeText(locale, "问答", "Ask"),
    capture_processing: localeText(locale, "资料处理", "Capture processing"),
    embedding: localeText(locale, "向量检索", "Embedding"),
    image_ocr: localeText(locale, "图片 OCR", "Image OCR"),
    retrieval: localeText(locale, "检索", "Retrieval"),
    semantic_indexing: localeText(locale, "语义索引", "Semantic indexing"),
    text: localeText(locale, "文本模型", "Text"),
    vision: localeText(locale, "视觉/OCR", "Vision/OCR"),
  };

  return labels[value] || value;
}

function formatPlanCode(value: string | null, locale: Locale) {
  if (!value) {
    return "-";
  }

  const labels: Record<string, string> = {
    free: localeText(locale, "免费版", "Free"),
    local: localeText(locale, "本地测试", "Local"),
    personal: localeText(locale, "个人版", "Personal"),
    pro: localeText(locale, "专业版", "Pro"),
    team: localeText(locale, "团队版", "Team"),
  };

  return labels[value] || value;
}

function formatQuotaSource(value: string, locale: Locale) {
  const labels: Record<string, string> = {
    gateway: localeText(locale, "云端网关", "Gateway"),
    local: localeText(locale, "本地配置", "Local"),
    stripe: localeText(locale, "支付系统", "Stripe"),
  };

  return labels[value] || value;
}

function formatEnforcementMode(value: string, locale: Locale) {
  const labels: Record<string, string> = {
    disabled: localeText(locale, "未启用", "Disabled"),
    hard: localeText(locale, "强限制", "Hard limit"),
    soft: localeText(locale, "软限制", "Soft limit"),
    unlimited: localeText(locale, "不限制", "Unlimited"),
  };

  return labels[value] || value;
}

function formatQuotaSummaryStatus(quota: QuotaRow | null, locale: Locale) {
  if (!quota) {
    return "-";
  }

  if (quota.stripe_subscription_status) {
    return formatSubscriptionStatus(quota.stripe_subscription_status, locale);
  }

  return formatQuotaSource(quota.quota_source, locale);
}

function getActivationPlan(planCode: string | null, monthlyCreditLimit: number | null) {
  return {
    monthlyCreditLimit,
    planCode: planCode || "personal",
  };
}

function formatSubscriptionStatus(value: string | null, locale: Locale) {
  if (!value) {
    return localeText(locale, "暂无", "None");
  }

  const labels: Record<string, string> = {
    active: localeText(locale, "有效", "Active"),
    canceled: localeText(locale, "已取消", "Canceled"),
    incomplete: localeText(locale, "未完成", "Incomplete"),
    past_due: localeText(locale, "逾期", "Past due"),
    trialing: localeText(locale, "试用中", "Trialing"),
  };

  return labels[value] || value;
}

function getTokenStatusLabel(value: string, locale: Locale) {
  const labels: Record<string, string> = {
    active: localeText(locale, "可用", "Active"),
    expired: localeText(locale, "已过期", "Expired"),
    revoked: localeText(locale, "已吊销", "Revoked"),
  };

  return labels[value] || value;
}

function getGatewayStatusLabel(value: string, locale: Locale) {
  const labels: Record<string, string> = {
    failure: localeText(locale, "失败", "Failure"),
    rejected: localeText(locale, "已拒绝", "Rejected"),
    reserved: localeText(locale, "已预留", "Reserved"),
    success: localeText(locale, "成功", "Success"),
  };

  return labels[value] || value;
}

function formatPurpose(value: string, locale: Locale) {
  if (locale !== "zh") {
    return value;
  }

  return value
    .replace(/^ask\.global/, "全局问答")
    .replace(/^ask\.wiki/, "知识页问答")
    .replace(/^capture\./, "资料处理.")
    .replace(/\.embedding$/, ".向量")
    .replace(/\.answer$/, ".回答")
    .replace(/_/g, " / ");
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function toNumber(value: string | number | null | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function isMissingRelationError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01";
}
