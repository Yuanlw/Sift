import { unstable_noStore as noStore } from "next/cache";
import { GatewayTokenManager } from "@/components/gateway-token-manager";
import { ModelSettingsForm } from "@/components/model-settings-form";
import { getBillingPlans, isStripeBillingConfigured, type BillingPlan } from "@/lib/billing";
import { query } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { formatDateTime, getLocale, localeText, type Locale } from "@/lib/i18n";
import { loadUserModelSettings, type ModelSettingsMode } from "@/lib/model-settings";
import {
  loadSmartQuotaSummary,
  type SmartQuotaAccount,
  type SmartQuotaCategory,
  type SmartQuotaEnforcementMode,
} from "@/lib/smart-quota";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { ModelCallRole, ModelCallStage } from "@/types/database";

interface UsageAggregateRow {
  stage: ModelCallStage;
  role: ModelCallRole;
  calls: string;
  failures: string;
  requests: string;
  input_chars: string | null;
  output_chars: string | null;
  prompt_tokens: string | null;
  completion_tokens: string | null;
  total_tokens: string | null;
  avg_duration_ms: string | null;
}

interface PurposeAggregateRow extends UsageAggregateRow {
  last_failed_at: string | null;
  last_failure: string | null;
  last_failure_host: string | null;
  purpose: string;
  model: string;
}

interface RecentFailureRow {
  endpoint_host: string | null;
  id: string;
  stage: ModelCallStage;
  role: ModelCallRole;
  purpose: string;
  model: string;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

interface UsageAggregate {
  avgDurationMs: number | null;
  calls: number;
  completionTokens: number;
  failures: number;
  inputChars: number;
  outputChars: number;
  promptTokens: number;
  requests: number;
  role: ModelCallRole;
  stage: ModelCallStage;
  totalTokens: number;
}

interface PurposeAggregate extends UsageAggregate {
  lastFailedAt: string | null;
  lastFailure: string | null;
  lastFailureHost: string | null;
  model: string;
  purpose: string;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: { account?: string; accountError?: string; accountScope?: string; revokedSessions?: string };
}) {
  noStore();

  const locale = getLocale();
  const env = getServerEnv();
  const userContext = await getUserContextFromHeaders();
  const billingPlans = getBillingPlans();
  const stripeConfigured = isStripeBillingConfigured();

  const [modelSettings, smartQuota, { rows: stageRoleRows }, { rows: purposeRows }, { rows: recentFailures }] = await Promise.all([
    loadUserModelSettings(userContext.userId),
    loadSmartQuotaSummary(userContext.userId),
    query<UsageAggregateRow>(
      `
        select
          stage,
          role,
          count(*)::text as calls,
          count(*) filter (where status = 'failed')::text as failures,
          coalesce(sum(request_count), 0)::text as requests,
          coalesce(sum(input_chars), 0)::text as input_chars,
          coalesce(sum(output_chars), 0)::text as output_chars,
          coalesce(sum(prompt_tokens), 0)::text as prompt_tokens,
          coalesce(sum(completion_tokens), 0)::text as completion_tokens,
          coalesce(sum(total_tokens), 0)::text as total_tokens,
          round(avg(duration_ms))::text as avg_duration_ms
        from model_call_logs
        where user_id = $1
          and created_at >= now() - interval '30 days'
        group by stage, role
        order by stage, role
      `,
      [userContext.userId],
    ),
    query<PurposeAggregateRow>(
      `
        select
          purpose,
          stage,
          role,
          model,
          count(*)::text as calls,
          count(*) filter (where status = 'failed')::text as failures,
          coalesce(sum(request_count), 0)::text as requests,
          coalesce(sum(input_chars), 0)::text as input_chars,
          coalesce(sum(output_chars), 0)::text as output_chars,
          coalesce(sum(prompt_tokens), 0)::text as prompt_tokens,
          coalesce(sum(completion_tokens), 0)::text as completion_tokens,
          coalesce(sum(total_tokens), 0)::text as total_tokens,
          round(avg(duration_ms))::text as avg_duration_ms,
          max(created_at) filter (where status = 'failed')::text as last_failed_at,
          (array_agg(error_message order by created_at desc) filter (where status = 'failed'))[1] as last_failure,
          (array_agg(endpoint_host order by created_at desc) filter (where status = 'failed'))[1] as last_failure_host
        from model_call_logs
        where user_id = $1
          and created_at >= now() - interval '30 days'
        group by purpose, stage, role, model
        order by count(*) filter (where status = 'failed') desc, count(*) desc, purpose
        limit 8
      `,
      [userContext.userId],
    ),
    query<RecentFailureRow>(
      `
        select id, stage, role, purpose, model, endpoint_host, duration_ms, error_message, created_at
        from model_call_logs
        where user_id = $1
          and status = 'failed'
        order by created_at desc
        limit 8
      `,
      [userContext.userId],
    ),
  ]);

  const stageRoleUsage = stageRoleRows.map(toUsageAggregate);
  const purposeUsage = purposeRows.map((row) => ({
    ...toUsageAggregate(row),
    lastFailedAt: row.last_failed_at,
    lastFailure: row.last_failure,
    lastFailureHost: row.last_failure_host,
    model: row.model,
    purpose: row.purpose,
  }));
  const failingPurposeUsage = purposeUsage.filter((item) => item.failures > 0);

  const totals = sumUsage(stageRoleUsage);
  const exposeModelDetails = modelSettings.mode === "custom";
  const accountNotice = getAccountNotice(searchParams, locale);
  const gatewayAuthorization = getGatewayAuthorizationSummary({
    configured: env.SIFT_MODEL_GATEWAY_CONFIGURED,
    identityLabel: userContext.email || userContext.displayName || shortUserId(userContext.userId),
    locale,
    planCode: smartQuota.account.planCode,
    quotaSource: smartQuota.account.quotaSource,
  });
  const accountReadiness = getAccountReadinessChecks({
    account: smartQuota.account,
    gatewayConfigured: env.SIFT_MODEL_GATEWAY_CONFIGURED,
    locale,
    modelMode: modelSettings.mode,
    remainingCredits: smartQuota.remainingCredits,
    schemaReady: smartQuota.schemaReady,
    stripeConfigured,
    usedCredits: smartQuota.usedCredits,
  });

  return (
    <div className="settings-page">
      <section className="hero settings-hero">
        <div className="eyebrow">{localeText(locale, "设置中心", "Settings")}</div>
        <h1>{localeText(locale, "账号、模型与消耗", "Account, Models, and Usage")}</h1>
        <p>
          {localeText(
            locale,
            "这里管理账号、模型使用方式、最近 30 天调用量和健康信号。默认模型只展示能力和消耗，不展示底层供应商或模型细节。",
            "Manage account, model mode, last-30-day usage, and health signals. Default models show capabilities and usage, not provider or model internals.",
          )}
        </p>
      </section>

      <div className="settings-layout">
        <SettingsSidebar locale={locale} />

        <div className="settings-content">
      <section className="settings-section settings-quick-summary" aria-label={localeText(locale, "账号摘要", "Account summary")}>
        <div className="settings-kv-grid">
          <KeyValue label={localeText(locale, "当前模式", "Current mode")} value={getModelModeShortLabel(modelSettings.mode, locale)} />
          <KeyValue label={localeText(locale, "模型通道", "Model channel")} value={getDefaultModelChannelLabel(modelSettings.mode, env.SIFT_MODEL_GATEWAY_CONFIGURED, locale)} />
          <KeyValue label={localeText(locale, "当前套餐", "Current plan")} value={getPlanDisplayName(smartQuota.account.planCode, locale)} />
          <KeyValue label={localeText(locale, "本月已用", "Used this month")} value={formatNumber(smartQuota.usedCredits, locale)} />
          <KeyValue
            label={localeText(locale, "剩余额度", "Remaining")}
            value={smartQuota.remainingCredits === null ? localeText(locale, "不限制", "Unlimited") : formatNumber(smartQuota.remainingCredits, locale)}
            tone={smartQuota.remainingCredits !== null && smartQuota.remainingCredits <= 0 ? "warning" : "ok"}
          />
        </div>
      </section>

      <section className="settings-section account-readiness" id="account-center" aria-labelledby="account-center-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="account-center-heading">{localeText(locale, "账号中心状态", "Account Center Status")}</h2>
            <p>
              {localeText(
                locale,
                "先看这三件事：订阅是否有效、额度是否够用、默认模型授权是否可用。这里就是个人订阅能不能顺利收钱和交付模型能力的最小闭环。",
                "Check these first: subscription state, quota health, and default-model authorization. This is the minimum loop for paid personal access to model capacity.",
              )}
            </p>
          </div>
        </div>
        <div className="account-readiness-grid">
          {accountReadiness.map((item) => (
            <a className={`account-readiness-card account-readiness-${item.tone}`} href={item.href} key={item.title}>
              <div>
                <span>{item.label}</span>
                <strong>{item.title}</strong>
              </div>
              <p>{item.body}</p>
              <small>{item.action}</small>
            </a>
          ))}
        </div>
      </section>

      <section className="settings-section" id="account" aria-labelledby="account-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="account-heading">{localeText(locale, "个人、账号与部署", "Profile, Account, and Deployment")}</h2>
            <p>{localeText(locale, "当前版本先接入本地邮箱密码账号；团队、邀请、找回密码和第三方登录会在后续账号阶段继续补齐。", "This version starts with local email/password accounts; teams, invites, password reset, and third-party login can be added in later account phases.")}</p>
          </div>
        </div>
        {accountNotice ? (
          <p className={`settings-message ${accountNotice.tone === "error" ? "settings-message-error" : "settings-message-success"}`}>
            {accountNotice.message}
          </p>
        ) : null}
        <div className="account-profile-card">
          <div className="account-avatar" aria-hidden="true">S</div>
          <div>
            <span>{localeText(locale, "个人工作区", "Personal workspace")}</span>
            <strong>{userContext.displayName || userContext.email || localeText(locale, "本地用户", "Local user")}</strong>
            <p>
              {userContext.email || localeText(locale, "当前仍使用本地默认用户；创建账号后会绑定到真实邮箱身份。", "Sift is still using the local default user; create an account to bind data to a real email identity.")}
            </p>
          </div>
          <div className="account-profile-meta">
            <span>{localeText(locale, "当前套餐", "Current plan")}</span>
            <strong>{getPlanDisplayName(smartQuota.account.planCode, locale)}</strong>
          </div>
        </div>
        <div className="settings-kv-grid">
          <KeyValue label={localeText(locale, "账号状态", "Account status")} value={userContext.source === "session" ? localeText(locale, "已登录", "Signed in") : localeText(locale, "本地可用", "Local ready")} tone="ok" />
          <KeyValue label={localeText(locale, "邮箱", "Email")} value={userContext.email || localeText(locale, "未绑定", "Not bound")} />
          <KeyValue label={localeText(locale, "当前用户", "Current User")} value={shortUserId(userContext.userId)} />
          <KeyValue label={localeText(locale, "身份来源", "Identity Source")} value={getUserSourceLabel(userContext.source, locale)} />
          <KeyValue
            label={localeText(locale, "受信请求头", "Trusted Header")}
            value={env.SIFT_TRUST_USER_HEADER ? localeText(locale, "已开启", "Enabled") : localeText(locale, "未开启", "Disabled")}
            tone={env.SIFT_TRUST_USER_HEADER ? "ok" : "muted"}
          />
          <KeyValue label={localeText(locale, "后台任务", "Job Dispatcher")} value={env.JOB_DISPATCHER} />
          <KeyValue
            label={localeText(locale, "Agent 接入密钥", "Agent API Key")}
            value={env.SIFT_AGENT_API_KEY ? localeText(locale, "已配置", "Configured") : localeText(locale, "未配置", "Not configured")}
            tone={env.SIFT_AGENT_API_KEY ? "ok" : "warning"}
          />
        </div>
        <div className="gateway-auth-card" id="gateway-auth">
          <div className="gateway-auth-heading">
            <div>
              <span>{localeText(locale, "默认模型授权", "Default model authorization")}</span>
              <h3>{localeText(locale, "Sift 模型网关授权", "Sift Gateway Authorization")}</h3>
              <p>{gatewayAuthorization.description}</p>
            </div>
            <strong className={`gateway-auth-status ${env.SIFT_MODEL_GATEWAY_CONFIGURED ? "gateway-auth-status-ok" : "gateway-auth-status-muted"}`}>
              {gatewayAuthorization.status}
            </strong>
          </div>
          <div className="settings-kv-grid gateway-auth-kv">
            <KeyValue label={localeText(locale, "令牌来源", "Token source")} value={gatewayAuthorization.source} tone={env.SIFT_MODEL_GATEWAY_CONFIGURED ? "ok" : "muted"} />
            <KeyValue label={localeText(locale, "绑定对象", "Bound to")} value={gatewayAuthorization.binding} />
            <KeyValue label={localeText(locale, "额度来源", "Quota source")} value={gatewayAuthorization.quota} />
            <KeyValue label={localeText(locale, "密钥边界", "Key boundary")} value={localeText(locale, "不暴露供应商密钥", "No provider keys exposed")} tone="ok" />
          </div>
          <div className="gateway-auth-actions">
            <div>
              <strong>{localeText(locale, "生命周期", "Lifecycle")}</strong>
              <p>
                {localeText(
                  locale,
                  "订阅账号签发模型网关令牌，并保存在服务端环境变量中；订阅取消、设备丢失或疑似泄露时，应在账号中心吊销并重新签发。",
                  "A subscribed account issues a Sift Gateway token, stored server-side. Cancellation, device loss, or suspected leakage should revoke and reissue it from the account center.",
                )}
              </p>
            </div>
          </div>
          <GatewayTokenManager locale={locale} />
        </div>
        {userContext.source === "session" ? (
          <>
            <div className="account-management-grid">
              <form action="/api/account/profile" className="account-management-form" method="post">
                <div>
                  <h3>{localeText(locale, "个人资料", "Profile")}</h3>
                  <p>{localeText(locale, "用于导航和设置页展示，不影响邮箱登录。", "Used in navigation and settings; it does not change your login email.")}</p>
                </div>
                <label>
                  {localeText(locale, "显示名称", "Display name")}
                  <input
                    autoComplete="name"
                    defaultValue={userContext.displayName || ""}
                    maxLength={80}
                    name="displayName"
                    placeholder={localeText(locale, "例如：老袁", "For example: Yuan")}
                    type="text"
                  />
                </label>
                <button className="button" type="submit">{localeText(locale, "保存资料", "Save profile")}</button>
              </form>

              <form action="/api/account/password" className="account-management-form" method="post">
                <div>
                  <h3>{localeText(locale, "修改密码", "Change password")}</h3>
                  <p>{localeText(locale, "修改后会保留当前登录，并让其他已登录设备失效。", "After changing it, Sift keeps this session and signs out other devices.")}</p>
                </div>
                <label>
                  {localeText(locale, "当前密码", "Current password")}
                  <input autoComplete="current-password" name="currentPassword" required type="password" />
                </label>
                <label>
                  {localeText(locale, "新密码", "New password")}
                  <input autoComplete="new-password" minLength={8} name="newPassword" required type="password" />
                </label>
                <label>
                  {localeText(locale, "确认新密码", "Confirm new password")}
                  <input autoComplete="new-password" minLength={8} name="newPasswordConfirm" required type="password" />
                </label>
                <button className="button" type="submit">{localeText(locale, "更新密码", "Update password")}</button>
              </form>
            </div>

            <form action="/api/auth/logout" className="settings-inline-form" method="post">
              <button className="button button-secondary" type="submit">{localeText(locale, "退出登录", "Log out")}</button>
            </form>
          </>
        ) : null}
      </section>

      <section className="settings-section" id="models" aria-labelledby="models-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="models-heading">{localeText(locale, "模型配置", "Model Configuration")}</h2>
            <p>{localeText(locale, "普通用户使用 Sift 默认模型即可；本地模型、API 密钥和企业网关放在自定义模式里。", "Most users can use Sift default models; local models, API keys, and company gateways belong in custom mode.")}</p>
          </div>
          <span className="settings-doc-note">{getModelModeLabel(modelSettings.mode, locale)}</span>
        </div>

        <ModelSettingsForm initialSettings={modelSettings} locale={locale} />
      </section>

      <section className="settings-section" id="quota" aria-labelledby="usage-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="usage-heading">{localeText(locale, "智能额度", "Smart Quota")}</h2>
            <p>{localeText(locale, "Sift 默认模型使用一套智能额度；本地默认端点记入智能额度，模型网关调用以网关用量账本为扣费事实。自定义模型不扣 Sift 额度。", "Sift default models use one smart quota. Local default endpoints debit smart quota, while Sift Gateway calls use the gateway usage ledger as the billing fact. Custom models do not consume Sift quota.")}</p>
          </div>
          <span className="settings-doc-note">{getQuotaModeLabel(smartQuota.account.enforcementMode, locale)}</span>
        </div>

        <div className="quota-overview">
          <div className="quota-meter-block">
            <div className="quota-meter-heading">
              <span>{localeText(locale, "本月智能额度", "Monthly Smart Quota")}</span>
              <strong>{formatQuotaBalance(smartQuota.usedCredits, smartQuota.account.monthlyCreditLimit, locale)}</strong>
            </div>
            <div className="quota-meter" aria-label={localeText(locale, "智能额度使用进度", "Smart quota usage")}>
              <span style={{ width: `${getQuotaPercent(smartQuota.usedCredits, smartQuota.account.monthlyCreditLimit)}%` }} />
            </div>
            <p>
              {!smartQuota.schemaReady
                ? localeText(locale, "额度表迁移完成后会开始写入账本；当前先按单租户不限制模式运行。", "Quota ledger migration is not applied yet; Sift is running in single-tenant unlimited mode for now.")
                : smartQuota.account.monthlyCreditLimit === null
                ? localeText(locale, "当前没有月度上限，但仍会记录消耗，方便排查成本和使用峰值。", "There is no monthly cap, but usage is still recorded for cost and spike diagnosis.")
                : localeText(
                    locale,
                    `剩余 ${formatNumber(smartQuota.remainingCredits || 0, locale)} / ${formatNumber(smartQuota.account.monthlyCreditLimit, locale)}。`,
                    `${formatNumber(smartQuota.remainingCredits || 0, locale)} / ${formatNumber(smartQuota.account.monthlyCreditLimit, locale)} remaining.`,
                  )}
            </p>
          </div>

          <div className="settings-kv-grid quota-kv-grid">
            <KeyValue label={localeText(locale, "套餐", "Plan")} value={getPlanDisplayName(smartQuota.account.planCode, locale)} />
            <KeyValue label={localeText(locale, "策略", "Policy")} value={getQuotaModeLabel(smartQuota.account.enforcementMode, locale)} tone={smartQuota.account.enforcementMode === "hard_limit" ? "warning" : "muted"} />
            <KeyValue label={localeText(locale, "已用额度", "Used")} value={formatNumber(smartQuota.usedCredits, locale)} />
            <KeyValue
              label={localeText(locale, "剩余额度", "Remaining")}
              value={smartQuota.remainingCredits === null ? localeText(locale, "不限制", "Unlimited") : formatNumber(smartQuota.remainingCredits, locale)}
              tone={smartQuota.remainingCredits !== null && smartQuota.remainingCredits <= 0 ? "warning" : "ok"}
            />
          </div>
        </div>

        <div className="settings-detail-block">
          <h3>{localeText(locale, "额度去向", "Quota Breakdown")}</h3>
          {smartQuota.breakdown.length > 0 ? (
            <div className="quota-breakdown-list">
              {smartQuota.breakdown.map((item) => (
                <div className="quota-breakdown-row" key={item.category}>
                  <div>
                    <strong>{getQuotaCategoryLabel(item.category, locale)}</strong>
                    <span>{getQuotaCategoryDescription(item.category, locale)}</span>
                  </div>
                  <b>{formatNumber(item.credits, locale)}</b>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={localeText(locale, "本月还没有额度消耗", "No quota usage this month")}
              body={localeText(locale, "使用 Sift 默认模型完成处理或问答后，这里会按能力展示消耗去向。", "After default-model processing or Ask requests, usage will appear here by capability.")}
            />
          )}
        </div>
      </section>

      <section className="settings-section" id="usage" aria-labelledby="usage-detail-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="usage-detail-heading">{localeText(locale, "模型消耗明细", "Model Usage Details")}</h2>
            <p>{localeText(locale, "最近 30 天的调用统计。令牌数取决于模型网关是否返回用量；未返回时会用字符数保留规模感。", "Last-30-day usage. Tokens depend on whether the model gateway returns usage; character counts keep a size signal when tokens are unavailable.")}</p>
          </div>
        </div>

        <div className="settings-stat-grid">
          <Stat label={localeText(locale, "调用", "Calls")} value={formatNumber(totals.calls, locale)} />
          <Stat label={localeText(locale, "失败", "Failures")} value={formatNumber(totals.failures, locale)} tone={totals.failures > 0 ? "warning" : "ok"} />
          <Stat label={localeText(locale, "令牌数", "Tokens")} value={formatNumber(totals.totalTokens, locale)} />
          <Stat label={localeText(locale, "平均耗时", "Avg Latency")} value={formatDuration(totals.avgDurationMs, locale)} />
        </div>

        {stageRoleUsage.length > 0 ? (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>{localeText(locale, "阶段", "Stage")}</th>
                  <th>{localeText(locale, "角色", "Role")}</th>
                  <th>{localeText(locale, "调用", "Calls")}</th>
                  <th>{localeText(locale, "失败", "Failures")}</th>
                  <th>{localeText(locale, "令牌数", "Tokens")}</th>
                  <th>{localeText(locale, "字符", "Chars")}</th>
                  <th>{localeText(locale, "平均耗时", "Avg Latency")}</th>
                </tr>
              </thead>
              <tbody>
                {stageRoleUsage.map((item) => (
                  <tr key={`${item.stage}-${item.role}`}>
                    <td>{getStageLabel(item.stage, locale)}</td>
                    <td>{getRoleLabel(item.role, locale)}</td>
                    <td>{formatNumber(item.calls, locale)}</td>
                    <td>{formatNumber(item.failures, locale)}</td>
                    <td>{formatNumber(item.totalTokens, locale)}</td>
                    <td>{formatNumber(item.inputChars + item.outputChars, locale)}</td>
                    <td>{formatDuration(item.avgDurationMs, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={localeText(locale, "还没有模型调用记录", "No model usage yet")}
            body={localeText(locale, "完成一次收集处理或问答后，这里会出现按阶段拆分的调用统计。", "After a capture is processed or an Ask request finishes, usage will appear here by stage.")}
          />
        )}
      </section>

      <section className="settings-section" id="health" aria-labelledby="details-heading">
        <div className="settings-section-heading settings-two-column-heading">
          <div>
            <h2 id="details-heading">{localeText(locale, "模型健康", "Model Health")}</h2>
            <p>{localeText(locale, "这里不做完整日志，只保留最近 30 天最需要处理的异常聚合和少量样本。", "This is not a full log view; it keeps the most actionable 30-day anomaly groups and a few recent samples.")}</p>
          </div>
        </div>

        <div className="settings-detail-grid">
          <div className="settings-detail-block">
            <h3>{localeText(locale, "异常用途", "Failing Purposes")}</h3>
            {failingPurposeUsage.length > 0 ? (
              <div className="settings-purpose-list">
                {failingPurposeUsage.map((item) => (
                  <div className="settings-purpose-row" key={getPurposeRowKey(item, exposeModelDetails)}>
                    <div>
                      <strong>{getPurposeLabel(item.purpose, locale)}</strong>
                      <span>
                        {getStageLabel(item.stage, locale)} / {getRoleLabel(item.role, locale)} /{" "}
                        {formatModelIdentity(item.role, item.model, item.lastFailureHost, modelSettings.mode, locale)}
                      </span>
                      <small>{diagnosePurposeFailure(item, locale, exposeModelDetails)}</small>
                    </div>
                    <div className="settings-purpose-metrics">
                      <span>{formatNumber(item.failures, locale)}</span>
                      <small>{localeText(locale, "失败", "failures")}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={localeText(locale, "最近没有异常用途", "No failing purposes")}
                body={localeText(locale, "如果某个模型用途连续失败，会在这里按用途合并展示。", "If a model purpose starts failing repeatedly, it will be grouped here.")}
              />
            )}
          </div>

          <div className="settings-detail-block">
            <h3>{localeText(locale, "最近失败样本", "Recent Failure Samples")}</h3>
            {recentFailures.length > 0 ? (
              <div className="settings-failure-list">
                {recentFailures.slice(0, 3).map((failure) => (
                  <div className="settings-failure-row" key={failure.id}>
                    <strong>{getPurposeLabel(failure.purpose, locale)}</strong>
                    <span>
                      {getStageLabel(failure.stage, locale)} / {getRoleLabel(failure.role, locale)} /{" "}
                      {formatModelIdentity(failure.role, failure.model, failure.endpoint_host, modelSettings.mode, locale)}
                    </span>
                    <small>
                      {formatDateTime(failure.created_at, locale, true)} · {formatDuration(failure.duration_ms, locale)}
                      {exposeModelDetails && failure.endpoint_host ? ` · ${failure.endpoint_host}` : ""}
                    </small>
                    <p>{diagnoseModelFailure(failure, locale, exposeModelDetails)}</p>
                    <p>{truncateError(failure.error_message, locale)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={localeText(locale, "最近没有失败调用", "No recent failures")}
                body={localeText(locale, "这很好。后续如果 OCR、embedding 或回答模型失败，会先在这里露出。", "Good. If OCR, embedding, or answer calls fail later, they will show up here first.")}
              />
            )}
            <p className="settings-log-note">
              {localeText(
                locale,
                "完整调用日志后续应进入独立日志页或管理 API，设置页只保留健康信号。",
                "Full call logs should move to a dedicated log page or admin API; settings only keeps health signals.",
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="settings-section" id="billing" aria-labelledby="billing-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="billing-heading">{localeText(locale, "计费与数据边界", "Billing and Data Boundaries")}</h2>
            <p>{localeText(locale, "这里说明省心订阅、本地自管模型、日志和额度之间的边界，避免用户被 API 密钥和模型供应商复杂度挡住。", "This explains the boundary between hassle-free subscriptions, self-managed models, logs, and quota so users are not blocked by API keys and provider complexity.")}</p>
          </div>
        </div>
        <div className="settings-note-grid">
          <div className="settings-note">
            <strong>{localeText(locale, "当前使用模式", "Current Mode")}</strong>
            <p>
              {modelSettings.mode === "custom"
                ? localeText(locale, "自定义模型。你自己的 API 密钥或本地网关产生的费用，由对应服务商或自有基础设施承担。", "Custom models. Costs from your own API keys or local gateways are paid to that provider or infrastructure.")
                : localeText(locale, "Sift 默认模型。页面只展示能力、额度和消耗；底层供应商、模型、端点和 API 密钥不对普通用户展示。", "Sift default models. This page shows capabilities, quota, and usage only; provider, model, endpoint, and API key details are not shown to regular users.")}
            </p>
          </div>
          <div className="settings-note">
            <strong>{localeText(locale, "Sift 模型网关", "Sift Model Gateway")}</strong>
            <p>{localeText(locale, "个人订阅可通过 Sift 模型网关获得开箱即用的模型能力；本地部署使用默认模型时，内容会发送到网关处理。网关令牌绑定 Sift 账号/订阅，可轮换或吊销，但不是底层供应商密钥。", "Personal subscriptions can use the Sift model gateway for out-of-the-box model capacity. In local deployments, default-model processing sends content to the gateway. Gateway tokens are bound to a Sift account/subscription and can be rotated or revoked; they are not provider keys.")}</p>
          </div>
          <div className="settings-note">
            <strong>{localeText(locale, "日志边界", "Logging Boundary")}</strong>
            <p>{localeText(locale, "模型调用日志只记录用途、路由角色、耗时、成功/失败、字符数和令牌数，不保存原文、图片、提示词或回答全文。", "Model logs store purpose, routing role, latency, success/failure, chars, and tokens, not source text, images, prompts, or full answers.")}</p>
          </div>
        </div>
      </section>

      <section className="settings-section" id="plans" aria-labelledby="plans-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="plans-heading">{localeText(locale, "套餐与升级", "Plans and Upgrade")}</h2>
            <p>
              {stripeConfigured
                ? localeText(locale, "SaaS 模式使用支付页面开通套餐；支付成功后，支付回调会自动更新本月智能额度。", "SaaS mode uses Stripe Checkout; after payment, webhooks update monthly smart quota automatically.")
                : localeText(locale, "当前支付系统未配置。本地单租户可继续不限制使用；SaaS 部署时配置支付系统后这里会出现可用升级入口。", "Stripe is not configured. Local single-tenant use remains unlimited; SaaS deployments can enable upgrade buttons after configuring Stripe.")}
            </p>
          </div>
          <span className="settings-doc-note">{stripeConfigured ? localeText(locale, "支付已启用", "Stripe") : localeText(locale, "未启用", "Disabled")}</span>
        </div>
        <div className="billing-plan-grid">
          {billingPlans.map((plan) => (
            <BillingPlanCard
              currentPlanCode={smartQuota.account.planCode}
              key={plan.code}
              locale={locale}
              plan={plan}
              stripeConfigured={stripeConfigured}
            />
          ))}
        </div>
      </section>

      <section className="settings-section" id="orders" aria-labelledby="orders-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="orders-heading">{localeText(locale, "订单、发票与凭证", "Orders, Invoices, and Receipts")}</h2>
            <p>
              {localeText(
                locale,
                "SaaS 模式下，订单、发票、退款和支付方式应以支付系统为准；Sift 只保存必要的订阅状态和额度结果。",
                "In SaaS mode, orders, invoices, refunds, and payment methods should be managed by Stripe; Sift only stores necessary subscription status and quota results.",
              )}
            </p>
          </div>
        </div>
        <div className="settings-note-grid settings-note-grid-compact">
          <div className="settings-note">
            <strong>{localeText(locale, "订阅状态", "Subscription Status")}</strong>
            <p>{getStripeSubscriptionStatusLabel(smartQuota.account.stripeSubscriptionStatus, smartQuota.account.quotaSource, locale)}</p>
          </div>
          <div className="settings-note">
            <strong>{localeText(locale, "账单中心", "Billing Portal")}</strong>
            <p>
              {smartQuota.account.stripeCustomerId
                ? localeText(locale, "进入账单中心管理发票、支付方式、取消订阅和套餐变更。", "Open Stripe to manage invoices, payment methods, cancellation, and plan changes.")
                : localeText(locale, "开通付费套餐后，这里会出现自助账单入口。", "After subscribing through Stripe, a self-service billing portal appears here.")}
            </p>
            <form action="/api/billing/portal" method="post">
              <button
                className="button button-secondary"
                disabled={!stripeConfigured || !smartQuota.account.stripeCustomerId}
                type="submit"
              >
                {localeText(locale, "管理账单", "Manage billing")}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="settings-section" id="faq" aria-labelledby="quota-faq-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="quota-faq-heading">{localeText(locale, "常见问题", "FAQ")}</h2>
            <p>{localeText(locale, "把额度、套餐和自定义模型这些容易困惑的点讲清楚。", "Clarify the parts that are easiest to misunderstand: quota, plans, and custom models.")}</p>
          </div>
        </div>
        <SettingsFaq locale={locale} />
      </section>
        </div>
      </div>
    </div>
  );
}

function BillingPlanCard({
  currentPlanCode,
  locale,
  plan,
  stripeConfigured,
}: {
  currentPlanCode: string;
  locale: Locale;
  plan: BillingPlan;
  stripeConfigured: boolean;
}) {
  const isCurrent = currentPlanCode === plan.code;
  const disabled = !stripeConfigured || !plan.enabled || isCurrent;
  const copy = getBillingPlanCopy(plan.code, locale);
  const planName = getPlanDisplayName(plan.code, locale);

  return (
    <div className="billing-plan-card">
      <div>
        <span>{isCurrent ? localeText(locale, "当前套餐", "Current plan") : planName}</span>
        <h3>{planName}</h3>
        <p>{copy.description}</p>
      </div>
      <strong>{plan.priceLabel || localeText(locale, "价格待配置", "Price to be configured")}</strong>
      <small>{formatNumber(plan.monthlyCredits, locale)} {localeText(locale, "智能额度/月", "credits/month")}</small>
      <ul>
        {copy.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <form action="/api/billing/checkout" method="post">
        <input name="planCode" type="hidden" value={plan.code} />
        <button className="button button-secondary" disabled={disabled} type="submit">
          {isCurrent
            ? localeText(locale, "已开通", "Active")
            : plan.enabled
            ? localeText(locale, "开通套餐", "Checkout with Stripe")
            : localeText(locale, "暂未开放", "Not available yet")}
        </button>
      </form>
      {!plan.enabled ? <small>{localeText(locale, "本地部署未启用支付；SaaS 配置后可开通。", "Billing is disabled locally; SaaS deployments can enable checkout.")}</small> : null}
    </div>
  );
}

function getBillingPlanCopy(code: string, locale: Locale) {
  const plans = {
    personal: {
      description: localeText(locale, "省心个人订阅：Sift 管模型和额度，适合日常收集、整理、问答，不要求用户配置 API 密钥。", "Hassle-free personal subscription: Sift manages model capacity and quota for daily capture, organization, and Ask without API key setup."),
      features: [
        localeText(locale, "默认使用 Sift 模型网关。", "Uses the Sift Model Gateway by default."),
        localeText(locale, "适合个人阅读、写作和资料回看。", "For personal reading, writing, and material review."),
        localeText(locale, "可随时切换到本地模型或自带密钥。", "Can switch to local models or BYOK anytime."),
      ],
    },
    pro: {
      description: localeText(locale, "给重度知识工作者：更多图片识别、批量处理、语义索引和高频问答空间。", "For heavy knowledge work: more room for OCR, batch processing, semantic indexing, and frequent Ask."),
      features: [
        localeText(locale, "更高月度智能额度。", "Higher monthly smart quota."),
        localeText(locale, "适合大量截图、长文和导入任务。", "For many screenshots, long articles, and imports."),
        localeText(locale, "适合搭配 Agent 上下文高频使用。", "Works well with frequent Agent Context use."),
      ],
    },
    team: {
      description: localeText(locale, "给内部团队和私有部署预留：共享额度、管理员控制、审计和支持。", "Reserved for internal teams and private rollout: shared quota, admin controls, audit, and support."),
      features: [
        localeText(locale, "当前先按账户开通，后续扩展工作区。", "Currently account-based, with workspace support later."),
        localeText(locale, "适合团队知识底座和 Agent 上下文。", "For team knowledge bases and Agent context."),
        localeText(locale, "可接企业模型网关或私有部署。", "Can connect to company model gateways or private deployment."),
      ],
    },
  };

  return plans[code as keyof typeof plans] || plans.personal;
}

function SettingsSidebar({ locale }: { locale: Locale }) {
  const groups = [
    {
      label: localeText(locale, "账户", "Account"),
      items: [
        { href: "#account-center", label: localeText(locale, "状态", "Status") },
        { href: "#account", label: localeText(locale, "概览", "Overview") },
        { href: "#quota", label: localeText(locale, "使用统计", "Usage") },
        { href: "#gateway-auth", label: localeText(locale, "网关授权", "Gateway auth") },
      ],
    },
    {
      label: localeText(locale, "计费", "Billing"),
      items: [
        { href: "#plans", label: localeText(locale, "定价方案", "Plans") },
        { href: "#orders", label: localeText(locale, "订单与发票", "Orders & invoices") },
      ],
    },
    {
      label: localeText(locale, "支持", "Support"),
      items: [
        { href: "#faq", label: localeText(locale, "常见问题", "FAQ") },
        { href: "/contact", label: localeText(locale, "联系我们", "Contact") },
      ],
    },
  ];

  return (
    <aside className="settings-sidebar" aria-label={localeText(locale, "设置导航", "Settings navigation")}>
      <nav>
        {groups.map((group) => (
          <div className="settings-sidebar-group" key={group.label}>
            <span className="settings-sidebar-label">{group.label}</span>
            {group.items.map((item) => (
              <a href={item.href} key={`${item.href}-${item.label}`}>
                <strong>{item.label}</strong>
              </a>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SettingsFaq({ locale }: { locale: Locale }) {
  const items = [
    {
      answer: localeText(
        locale,
        "智能额度是 Sift 默认模型的一套统一计量方式，覆盖资料处理、图片识别、语义索引、知识问答和检索召回。它不是单独卖某一个模型，也不会向用户暴露底层模型供应商或 API 密钥。",
        "Smart quota is one unified meter for Sift default models, covering material processing, image OCR, semantic indexing, Ask, and retrieval. It is not a separate charge for one specific model and does not expose underlying model providers or API keys.",
      ),
      question: localeText(locale, "额度与计费规则", "Quota and billing rules"),
    },
    {
      answer: localeText(
        locale,
        "本地单租户默认不硬限制额度，只记录消耗。使用 Sift 默认模型代表处理内容会调用 Sift 模型网关；自定义模型模式不扣 Sift 智能额度，费用由用户自己的模型服务商或本地网关承担。",
        "Local single-tenant mode does not hard-block quota by default and only records usage. Using Sift default models means processing content through the Sift model gateway; custom model mode does not consume Sift smart quota because costs belong to the user's provider or local gateway.",
      ),
      question: localeText(locale, "灵活额度说明", "Flexible quota"),
    },
    {
      answer: localeText(
        locale,
        "正式 SaaS 版本会通过支付页面升级套餐。支付成功后，支付回调会把套餐和本月额度写回 Sift。支付系统未配置时，本地部署的升级按钮保持不可用。",
        "Hosted SaaS upgrades use Stripe Checkout. After payment, Stripe webhooks update the plan and monthly quota in Sift. When Stripe is not configured, upgrade buttons remain disabled for local deployments.",
      ),
      question: localeText(locale, "如何升级套餐？", "How do I upgrade?"),
    },
    {
      answer: localeText(
        locale,
        "月度额度应随订阅周期恢复。取消订阅或支付失败后，支付回调会把账号降级到免费/小额度策略；已经保存的原始资料不应该因为额度不足而丢失。",
        "Monthly quota should renew with the subscription period. Cancellation or failed payment downgrades the account through webhooks; already saved raw captures should not be lost because of quota shortage.",
      ),
      question: localeText(locale, "额度恢复机制", "Quota renewal"),
    },
    {
      answer: localeText(
        locale,
        "套餐变化由支付系统作为事实来源。Sift 只根据支付回调结果更新套餐、订阅状态和智能额度，避免在产品内维护两套互相冲突的支付状态。",
        "Stripe is the payment source of truth for plan changes. Sift only updates plan, subscription status, and smart quota from webhook results, avoiding conflicting payment state inside the product.",
      ),
      question: localeText(locale, "套餐变更说明", "Plan changes"),
    },
  ];

  return (
    <div className="settings-faq-list">
      {items.map((item) => (
        <details className="settings-faq-item" key={item.question}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
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
      <strong className={`settings-value settings-value-${tone}`}>{value}</strong>
    </div>
  );
}

function Stat({ label, tone = "muted", value }: { label: string; tone?: "muted" | "ok" | "warning"; value: string }) {
  return (
    <div className="settings-stat">
      <span>{label}</span>
      <strong className={`settings-value-${tone}`}>{value}</strong>
    </div>
  );
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: "ok" | "warning" }) {
  return <span className={`settings-status settings-status-${tone}`}>{children}</span>;
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="settings-empty">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function toUsageAggregate(row: UsageAggregateRow): UsageAggregate {
  return {
    avgDurationMs: row.avg_duration_ms === null ? null : toNumber(row.avg_duration_ms),
    calls: toNumber(row.calls),
    completionTokens: toNumber(row.completion_tokens),
    failures: toNumber(row.failures),
    inputChars: toNumber(row.input_chars),
    outputChars: toNumber(row.output_chars),
    promptTokens: toNumber(row.prompt_tokens),
    requests: toNumber(row.requests),
    role: row.role,
    stage: row.stage,
    totalTokens: toNumber(row.total_tokens),
  };
}

function sumUsage(items: UsageAggregate[]) {
  const calls = items.reduce((sum, item) => sum + item.calls, 0);
  const totalDuration = items.reduce((sum, item) => sum + (item.avgDurationMs || 0) * item.calls, 0);

  return {
    avgDurationMs: calls > 0 ? Math.round(totalDuration / calls) : null,
    calls,
    failures: items.reduce((sum, item) => sum + item.failures, 0),
    inputChars: items.reduce((sum, item) => sum + item.inputChars, 0),
    outputChars: items.reduce((sum, item) => sum + item.outputChars, 0),
    totalTokens: items.reduce((sum, item) => sum + item.totalTokens, 0),
  };
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortUserId(value: string) {
  return value.length > 13 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function getAccountNotice(
  searchParams: { account?: string; accountError?: string; revokedSessions?: string } | undefined,
  locale: Locale,
) {
  if (searchParams?.accountError) {
    return {
      message: searchParams.accountError,
      tone: "error" as const,
    };
  }

  if (searchParams?.account === "profile-updated") {
    return {
      message: localeText(locale, "个人资料已保存。", "Profile saved."),
      tone: "success" as const,
    };
  }

  if (searchParams?.account === "password-updated") {
    const revokedSessions = toNumber(searchParams.revokedSessions);
    return {
      message:
        revokedSessions > 0
          ? localeText(locale, `密码已更新，已让 ${revokedSessions} 个其他会话失效。`, `Password updated. ${revokedSessions} other sessions were signed out.`)
          : localeText(locale, "密码已更新。", "Password updated."),
      tone: "success" as const,
    };
  }

  return null;
}

function getUserSourceLabel(source: "agent_api_key" | "default" | "session" | "trusted_header", locale: Locale) {
  if (source === "session") {
    return localeText(locale, "登录会话", "Signed-in session");
  }

  if (source === "trusted_header") {
    return localeText(locale, "受信请求头", "Trusted header");
  }

  if (source === "agent_api_key") {
    return localeText(locale, "Agent 接入密钥", "Agent API key");
  }

  return localeText(locale, "默认单用户", "Default single user");
}

function getStageLabel(stage: ModelCallStage, locale: Locale) {
  const labels: Record<ModelCallStage, string> = {
    agent: localeText(locale, "Agent", "Agent"),
    ask: localeText(locale, "问答", "Ask"),
    management: localeText(locale, "管理", "Management"),
    processing: localeText(locale, "处理", "Processing"),
    retrieval: localeText(locale, "检索", "Retrieval"),
  };

  return labels[stage];
}

function getRoleLabel(role: ModelCallRole, locale: Locale) {
  const labels: Record<ModelCallRole, string> = {
    embedding: localeText(locale, "向量", "Embedding"),
    text: localeText(locale, "文本", "Text"),
    vision: localeText(locale, "视觉", "Vision"),
  };

  return labels[role];
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(value);
}

function formatDuration(value: number | null, locale: Locale) {
  if (!value) {
    return localeText(locale, "-", "-");
  }

  if (value < 1000) {
    return `${formatNumber(value, locale)}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
}

function formatQuotaBalance(usedCredits: number, monthlyCreditLimit: number | null, locale: Locale) {
  if (monthlyCreditLimit === null) {
    return localeText(locale, `${formatNumber(usedCredits, locale)} 已用 / 不限制`, `${formatNumber(usedCredits, locale)} used / unlimited`);
  }

  return `${formatNumber(usedCredits, locale)} / ${formatNumber(monthlyCreditLimit, locale)}`;
}

function getQuotaPercent(usedCredits: number, monthlyCreditLimit: number | null) {
  if (!monthlyCreditLimit) {
    return Math.min(100, usedCredits > 0 ? 12 : 0);
  }

  return Math.min(100, Math.round((usedCredits / monthlyCreditLimit) * 100));
}

function getQuotaModeLabel(mode: SmartQuotaEnforcementMode, locale: Locale) {
  const labels: Record<SmartQuotaEnforcementMode, string> = {
    hard_limit: localeText(locale, "硬限制", "Hard limit"),
    soft_limit: localeText(locale, "提醒限制", "Soft limit"),
    unlimited: localeText(locale, "单租户不限制", "Single-tenant unlimited"),
  };

  return labels[mode];
}

function getQuotaCategoryLabel(category: SmartQuotaCategory, locale: Locale) {
  const labels: Record<SmartQuotaCategory, string> = {
    ask: localeText(locale, "知识问答", "Ask"),
    capture_processing: localeText(locale, "资料处理", "Material processing"),
    image_ocr: localeText(locale, "图片识别", "Image OCR"),
    retrieval: localeText(locale, "检索召回", "Retrieval"),
    semantic_indexing: localeText(locale, "语义索引", "Semantic indexing"),
  };

  return labels[category];
}

function getQuotaCategoryDescription(category: SmartQuotaCategory, locale: Locale) {
  const labels: Record<SmartQuotaCategory, string> = {
    ask: localeText(locale, "全库问答和单页问答的回答生成。", "Answer generation for global and page-level Ask."),
    capture_processing: localeText(locale, "把资料整理成来源摘要和知识页。", "Structuring captures into source summaries and wiki pages."),
    image_ocr: localeText(locale, "截图和相册图片的文字识别。", "Text recognition for screenshots and photo captures."),
    retrieval: localeText(locale, "语义搜索、管理搜索和 Agent 上下文召回。", "Semantic search, management search, and Agent context retrieval."),
    semantic_indexing: localeText(locale, "写入向量，支持后续搜索和问答。", "Embedding writes for later search and Ask."),
  };

  return labels[category];
}

function truncateError(value: string | null, locale: Locale) {
  if (!value) {
    return localeText(locale, "没有错误详情。", "No error detail.");
  }

  return value.length > 140 ? `${value.slice(0, 140)}...` : value;
}

function diagnoseModelFailure(failure: RecentFailureRow, locale: Locale, exposeModelDetails: boolean) {
  return diagnoseFailureText({
    endpointHost: exposeModelDetails ? failure.endpoint_host : null,
    errorMessage: failure.error_message,
    locale,
    verbose: true,
  });
}

function diagnosePurposeFailure(failure: PurposeAggregate, locale: Locale, exposeModelDetails: boolean) {
  return diagnoseFailureText({
    endpointHost: exposeModelDetails ? failure.lastFailureHost : null,
    errorMessage: failure.lastFailure,
    locale,
    verbose: false,
  });
}

function getModelModeLabel(mode: ModelSettingsMode, locale: Locale) {
  return mode === "custom"
    ? localeText(locale, "当前：自定义模型", "Current: custom models")
    : localeText(locale, "当前：Sift 默认模型", "Current: Sift default models");
}

function getModelModeShortLabel(mode: ModelSettingsMode, locale: Locale) {
  return mode === "custom" ? localeText(locale, "自定义模型", "Custom") : localeText(locale, "默认模型", "Default");
}

function getDefaultModelChannelLabel(mode: ModelSettingsMode, gatewayConfigured: boolean, locale: Locale) {
  if (mode === "custom") {
    return localeText(locale, "本地/自带密钥", "Local/BYOK");
  }

  return gatewayConfigured
    ? localeText(locale, "Sift 模型网关", "Sift Gateway")
    : localeText(locale, "本地默认端点", "Local default endpoint");
}

function getAccountReadinessChecks({
  account,
  gatewayConfigured,
  locale,
  modelMode,
  remainingCredits,
  schemaReady,
  stripeConfigured,
  usedCredits,
}: {
  account: SmartQuotaAccount;
  gatewayConfigured: boolean;
  locale: Locale;
  modelMode: ModelSettingsMode;
  remainingCredits: number | null;
  schemaReady: boolean;
  stripeConfigured: boolean;
  usedCredits: number;
}) {
  const quotaPercent =
    account.monthlyCreditLimit === null ? null : Math.round((usedCredits / Math.max(1, account.monthlyCreditLimit)) * 100);
  const subscription = getSubscriptionReadiness(account, stripeConfigured, locale);
  const quota = getQuotaReadiness(account, remainingCredits, quotaPercent, schemaReady, locale);
  const gateway = getGatewayReadiness(modelMode, gatewayConfigured, locale);

  return [subscription, quota, gateway];
}

function getSubscriptionReadiness(account: SmartQuotaAccount, stripeConfigured: boolean, locale: Locale) {
  if (account.quotaSource !== "stripe") {
    return {
      action: stripeConfigured
        ? localeText(locale, "可到套餐区开通付费订阅", "Subscribe from Plans")
        : localeText(locale, "本地/人工开通模式", "Local/manual mode"),
      body: stripeConfigured
        ? localeText(
            locale,
            "当前还不是付费订阅账号；公开收费用支付页面开通后，套餐和额度会由支付回调同步。",
            "This is not a Stripe subscription account yet. Paid hosted accounts sync plan and quota through Stripe webhooks after checkout.",
          )
        : localeText(
            locale,
            "当前部署没有启用支付系统，适合本地试用、人工开通或私有部署，不影响本地保存和自定义模型。",
            "Stripe is not enabled in this deployment. This fits local use, manual activation, or private installs, and does not block local capture or custom models.",
          ),
      href: "#plans",
      label: localeText(locale, "订阅", "Subscription"),
      title: getPlanDisplayName(account.planCode, locale),
      tone: stripeConfigured ? "warning" : "muted",
    } as const;
  }

  const active = account.stripeSubscriptionStatus === "active" || account.stripeSubscriptionStatus === "trialing";

  return {
    action: active
      ? localeText(locale, "账单中心可管理发票和支付方式", "Manage invoices and payment methods")
      : localeText(locale, "需要回到账单或套餐区处理", "Resolve from Billing or Plans"),
    body: getStripeSubscriptionStatusLabel(account.stripeSubscriptionStatus, account.quotaSource, locale),
    href: active ? "#orders" : "#plans",
    label: localeText(locale, "订阅", "Subscription"),
    title: getPlanDisplayName(account.planCode, locale),
    tone: active ? "ok" : "warning",
  } as const;
}

function getQuotaReadiness(
  account: SmartQuotaAccount,
  remainingCredits: number | null,
  quotaPercent: number | null,
  schemaReady: boolean,
  locale: Locale,
) {
  if (!schemaReady) {
    return {
      action: localeText(locale, "先完成数据库迁移", "Apply database migrations"),
      body: localeText(
        locale,
        "额度表还没有准备好；产品仍可本地运行，但无法形成可靠的订阅额度账本。",
        "Quota tables are not ready yet. The product can still run locally, but subscription quota cannot be reliably accounted for.",
      ),
      href: "#quota",
      label: localeText(locale, "额度", "Quota"),
      title: localeText(locale, "账本未就绪", "Ledger not ready"),
      tone: "warning",
    } as const;
  }

  if (account.monthlyCreditLimit === null || remainingCredits === null) {
    return {
      action: localeText(locale, "查看本月消耗", "Review monthly usage"),
      body: localeText(
        locale,
        "当前额度不设硬上限，但仍会记录消耗，适合本地或人工开通阶段观察成本。",
        "This account has no hard monthly cap, but usage is still recorded for local/manual cost observation.",
      ),
      href: "#quota",
      label: localeText(locale, "额度", "Quota"),
      title: localeText(locale, "不限制", "Unlimited"),
      tone: "muted",
    } as const;
  }

  const low = account.enforcementMode === "hard_limit" && remainingCredits <= Math.max(50, account.monthlyCreditLimit * 0.15);

  return {
    action: low ? localeText(locale, "考虑升级或切换模型模式", "Upgrade or switch model mode") : localeText(locale, "查看额度去向", "Review usage breakdown"),
    body: localeText(
      locale,
      `本月已使用约 ${quotaPercent || 0}%，剩余 ${formatNumber(remainingCredits, locale)} / ${formatNumber(account.monthlyCreditLimit, locale)}。`,
      `About ${quotaPercent || 0}% used this month, ${formatNumber(remainingCredits, locale)} / ${formatNumber(account.monthlyCreditLimit, locale)} remaining.`,
    ),
    href: low ? "#plans" : "#quota",
    label: localeText(locale, "额度", "Quota"),
    title: remainingCredits <= 0 ? localeText(locale, "已用完", "Depleted") : localeText(locale, "可用", "Available"),
    tone: low ? "warning" : "ok",
  } as const;
}

function getGatewayReadiness(modelMode: ModelSettingsMode, gatewayConfigured: boolean, locale: Locale) {
  if (modelMode === "custom") {
    return {
      action: localeText(locale, "检查自定义模型配置", "Check custom model settings"),
      body: localeText(
        locale,
        "当前使用本地模型、自带密钥或企业网关；Sift 模型网关令牌不是必需项。",
        "This account uses local models, BYOK, or a company gateway. A Sift Gateway token is not required.",
      ),
      href: "#models",
      label: localeText(locale, "模型授权", "Model auth"),
      title: localeText(locale, "自定义模型", "Custom models"),
      tone: "muted",
    } as const;
  }

  return {
    action: gatewayConfigured
      ? localeText(locale, "管理令牌和设备", "Manage tokens and devices")
      : localeText(locale, "签发并配置网关令牌", "Issue and configure a Gateway token"),
    body: gatewayConfigured
      ? localeText(
          locale,
          "默认模型已经通过服务端网关令牌授权，普通用户不需要供应商 API 密钥。",
          "Default models are authorized through a server-side Gateway token, so regular users do not need provider API keys.",
        )
      : localeText(
          locale,
          "默认模型尚未接入 Sift 模型网关；个人订阅交付前，应先签发令牌并配置到服务端环境变量。",
          "Default models are not connected to Sift Gateway yet. Before delivering a personal subscription, issue a token and configure it server-side.",
        ),
    href: "#gateway-auth",
    label: localeText(locale, "模型授权", "Model auth"),
    title: gatewayConfigured ? localeText(locale, "已配置", "Configured") : localeText(locale, "未配置", "Not configured"),
    tone: gatewayConfigured ? "ok" : "warning",
  } as const;
}

function getGatewayAuthorizationSummary({
  configured,
  identityLabel,
  locale,
  planCode,
  quotaSource,
}: {
  configured: boolean;
  identityLabel: string;
  locale: Locale;
  planCode: string;
  quotaSource: string;
}) {
  return {
    binding: configured
      ? `${identityLabel} / ${getPlanDisplayName(planCode, locale)}`
      : localeText(locale, "等待订阅账号绑定", "Waiting for subscription account binding"),
    description: configured
      ? localeText(
          locale,
          "当前默认模型会通过 Sift 模型网关授权调用，普通用户无需配置兼容接口或供应商 API 密钥。",
          "Default models are currently authorized through Sift Gateway, so regular users do not need OpenAI-compatible endpoints or provider API keys.",
        )
      : localeText(
          locale,
          "当前没有配置 Sift 模型网关令牌；默认模型会回退到本地默认端点，或由高级模式使用自管模型。",
          "No Sift Gateway token is configured; default models fall back to the local default endpoint, or advanced mode can use self-managed models.",
        ),
    quota: getGatewayQuotaSourceLabel(quotaSource, locale),
    source: configured
      ? localeText(locale, "服务端环境变量", "Server environment")
      : localeText(locale, "未签发", "Not issued"),
    status: configured
      ? localeText(locale, "已配置", "Configured")
      : localeText(locale, "未配置", "Not configured"),
  };
}

function getGatewayQuotaSourceLabel(quotaSource: string, locale: Locale) {
  const labels: Record<string, string> = {
    local: localeText(locale, "本地/开发额度", "Local/development quota"),
    manual: localeText(locale, "手动分配额度", "Manual quota"),
    stripe: localeText(locale, "订阅额度", "Subscription quota"),
  };

  return labels[quotaSource] || quotaSource;
}

function getPlanDisplayName(planCode: string, locale: Locale) {
  const labels: Record<string, string> = {
    free: localeText(locale, "免费版", "Free"),
    local: localeText(locale, "本地测试", "Local"),
    personal: localeText(locale, "个人版", "Personal"),
    pro: localeText(locale, "专业版", "Pro"),
    team: localeText(locale, "团队版", "Team"),
  };

  return labels[planCode] || planCode;
}

function getStripeSubscriptionStatusLabel(
  status: string | null,
  quotaSource: "local" | "stripe" | "manual",
  locale: Locale,
) {
  if (quotaSource !== "stripe") {
    return localeText(locale, "当前是本地/手动额度，不由支付系统管理。", "This account is using local/manual quota, not Stripe billing.");
  }

  const labels: Record<string, string> = {
    active: localeText(locale, "订阅有效，额度按当前套餐使用。", "Subscription is active; quota follows the current plan."),
    canceled: localeText(locale, "订阅已取消，后续会使用免费/降级额度。", "Subscription is canceled; the account will use free/downgraded quota."),
    incomplete: localeText(locale, "订阅未完成，请回到支付页面完成付款。", "Subscription is incomplete; finish payment in Stripe."),
    incomplete_expired: localeText(locale, "订阅未完成且已过期，需要重新开通。", "Incomplete subscription expired; subscribe again."),
    past_due: localeText(locale, "付款逾期，额度可能已被降级。", "Payment is past due; quota may be downgraded."),
    trialing: localeText(locale, "试用中，额度按当前试用/套餐规则使用。", "Trial is active; quota follows the trial or plan rules."),
    unpaid: localeText(locale, "付款失败且未结清，额度已降级。", "Payment failed and remains unpaid; quota is downgraded."),
  };

  return labels[status || ""] || localeText(locale, "支付状态等待同步。", "Waiting for Stripe status sync.");
}

function getPurposeLabel(purpose: string, locale: Locale) {
  const labels: Record<string, string> = {
    "agent.query": localeText(locale, "Agent 上下文检索", "Agent context retrieval"),
    "ask.answer": localeText(locale, "全库问答生成", "Global Ask answer"),
    "ask.retrieve": localeText(locale, "全库问答召回", "Global Ask retrieval"),
    "capture.create_embeddings": localeText(locale, "语义索引写入", "Semantic index write"),
    "capture.extract": localeText(locale, "资料理解与整理", "Material understanding"),
    "capture.ocr": localeText(locale, "图片文字识别", "Image OCR"),
    "wiki.ask.answer": localeText(locale, "知识页问答生成", "Wiki Ask answer"),
    "wiki.ask.retrieve": localeText(locale, "知识页问答召回", "Wiki Ask retrieval"),
  };

  return labels[purpose] || purpose.replaceAll("_", " ").replaceAll(".", " / ");
}

function formatModelIdentity(
  role: ModelCallRole,
  model: string,
  host: string | null,
  mode: ModelSettingsMode,
  locale: Locale,
) {
  if (mode !== "custom") {
    return localeText(locale, `${getRoleLabel(role, locale)}默认能力`, `Default ${getRoleLabel(role, locale)} capability`);
  }

  return host ? `${model} / ${host}` : model;
}

function getPurposeRowKey(item: PurposeAggregate, exposeModelDetails: boolean) {
  const baseKey = `${item.purpose}-${item.stage}-${item.role}`;
  return exposeModelDetails ? `${baseKey}-${item.model}` : baseKey;
}

function diagnoseFailureText(input: { endpointHost: string | null; errorMessage: string | null; locale: Locale; verbose: boolean }) {
  const message = input.errorMessage || "";

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|other side closed/i.test(message)) {
    if (!input.endpointHost) {
      return localeText(
        input.locale,
        input.verbose
          ? "默认模型通道暂时不可达。原始资料仍会保留，可以稍后重试处理；如果连续出现，请检查服务端模型配置。"
          : "默认模型通道暂时不可达，可以稍后重试。",
        input.verbose
          ? "The default model channel is temporarily unavailable. Raw captures remain saved and can be retried later; if this keeps happening, check the server-side model setup."
          : "The default model channel is temporarily unavailable. Try again later.",
      );
    }

    return localeText(
      input.locale,
      input.verbose
        ? `网络连接失败：Sift 服务端没有连上 ${input.endpointHost || "模型 endpoint"}。优先检查模型网关是否启动、端口是否可达、Docker/本机 host 配置是否一致。`
        : `网络连接异常，重点检查 ${input.endpointHost || "模型 endpoint"} 是否可达。`,
      input.verbose
        ? `Network failure: the Sift server could not reach ${input.endpointHost || "the model endpoint"}. Check whether the model gateway is running, the port is reachable, and Docker/local host settings match.`
        : `Network issue. Check whether ${input.endpointHost || "the model endpoint"} is reachable.`,
    );
  }

  if (/401|403|unauthorized|forbidden/i.test(message)) {
    return localeText(input.locale, "鉴权失败：检查对应模型 API 密钥或网关权限。", "Auth failure: check the model API key or gateway permissions.");
  }

  if (/404|model/i.test(message)) {
    return localeText(input.locale, "模型或接口路径可能不匹配：检查模型名称、base URL 和 OpenAI-compatible 路径。", "Model or endpoint mismatch: check the model name, base URL, and OpenAI-compatible path.");
  }

  return localeText(input.locale, "模型调用失败：保留了原始错误，建议结合 endpoint host 和模型配置排查。", "Model call failed: the raw error is preserved; use it with the endpoint host and model config.");
}
