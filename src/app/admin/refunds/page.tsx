import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { requireSupportAdmin } from "@/lib/admin-auth";
import { normalizeEmail } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, getLocale, localeText, type Locale } from "@/lib/i18n";

interface RefundRow {
  amount_cents: number;
  created_at: string;
  currency: string;
  id: string;
  notes: string | null;
  offline_reference: string | null;
  offline_transfer_method: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  plan_code_snapshot: string | null;
  gateway_tokens_reviewed_at: string | null;
  quota_reviewed_at: string | null;
  reason: string;
  status: "cancelled" | "paid" | "requested";
  subscription_cancelled_at: string | null;
  stripe_customer_id_snapshot: string | null;
  stripe_subscription_id_snapshot: string | null;
  user_contacted_at: string | null;
  user_email: string;
}

export default async function ManualRefundsPage({
  searchParams,
}: {
  searchParams?: { email?: string; status?: string };
}) {
  noStore();

  await requireSupportAdmin("/admin/refunds");

  const locale = getLocale();
  const email = normalizeSearchEmail(searchParams?.email);
  const notice = getNotice(searchParams?.status, locale);
  const refunds = await loadManualRefunds(email);

  return (
    <div className="admin-page">
      <section className="hero settings-hero">
        <div className="eyebrow">{localeText(locale, "运营后台", "Admin")}</div>
        <h1>{localeText(locale, "人工退款台", "Manual Refund Desk")}</h1>
        <p>
          {localeText(
            locale,
            "这里登记和跟进线下人工退款。Sift 不自动调用支付平台退款接口，不承诺原路退回；运营完成线下打款后，在这里记录打款方式和凭证。",
            "Register and track offline manual refunds here. Sift does not call the Stripe Refund API and does not promise original-route refunds; after offline transfer, record the method and reference here.",
          )}
        </p>
      </section>

      {notice ? <p className="settings-message settings-message-success">{notice}</p> : null}

      <div className="admin-refund-layout">
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>{localeText(locale, "登记退款", "Create Refund")}</h2>
              <p>{localeText(locale, "登记后状态为待处理。请在线下完成打款，再回到列表标记已打款。", "New records start as requested. Complete the offline transfer, then mark it as paid in the list.")}</p>
            </div>
          </div>
          <form action="/api/admin/manual-refunds" className="admin-refund-form" method="post">
            <input name="action" type="hidden" value="create" />
            <label>
              {localeText(locale, "用户邮箱", "User email")}
              <input autoComplete="email" defaultValue={email} name="userEmail" required type="email" />
            </label>
            <div className="admin-refund-form-row">
              <label>
                {localeText(locale, "退款金额", "Amount")}
                <input inputMode="decimal" min="0.01" name="amount" placeholder="99.00" required step="0.01" type="number" />
              </label>
              <label>
                {localeText(locale, "币种", "Currency")}
                <select defaultValue="CNY" name="currency">
                  <option value="CNY">{localeText(locale, "人民币", "CNY")}</option>
                  <option value="USD">{localeText(locale, "美元", "USD")}</option>
                  <option value="HKD">{localeText(locale, "港币", "HKD")}</option>
                </select>
              </label>
            </div>
            <label>
              {localeText(locale, "支付/订单线索", "Payment reference")}
              <input name="paymentReference" placeholder={localeText(locale, "支付客户号、订阅号、转账备注等", "Stripe customer, subscription id, transfer memo, etc.")} type="text" />
            </label>
            <label>
              {localeText(locale, "退款原因", "Reason")}
              <textarea name="reason" required rows={4} />
            </label>
            <label>
              {localeText(locale, "内部备注", "Internal notes")}
              <textarea name="notes" rows={3} />
            </label>
            <button className="button" type="submit">{localeText(locale, "创建退款工单", "Create refund record")}</button>
          </form>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>{localeText(locale, "筛选", "Filter")}</h2>
              <p>{localeText(locale, "按邮箱缩小列表，也可以从账号支持页跳转过来。", "Filter by email, or jump here from the account support page.")}</p>
            </div>
          </div>
          <form className="admin-search-form" method="get">
            <input autoComplete="email" defaultValue={email} name="email" placeholder="user@example.com" type="email" />
            <button className="button button-secondary" type="submit">{localeText(locale, "筛选", "Filter")}</button>
          </form>
          <div className="settings-note">
            <strong>{localeText(locale, "重要边界", "Important boundary")}</strong>
            <p>
              {localeText(
                locale,
                "这个页面只记录人工退款流程。真正的线下走款、银行转账、微信/支付宝退款或财务打款，需要运营在外部完成。",
                "This page only records the manual refund workflow. The actual bank transfer, WeChat/Alipay refund, or finance payout happens outside Sift.",
              )}
            </p>
          </div>
          <Link className="button button-secondary" href={email ? `/admin/account-support?email=${encodeURIComponent(email)}` : "/admin/account-support"}>
            {localeText(locale, "查看账号支持页", "Open account support")}
          </Link>
        </section>
      </div>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
              <h2>{localeText(locale, "退款记录", "Refund Records")}</h2>
              <p>{localeText(locale, "默认展示最近 50 条。待处理记录可以标记已线下打款或取消。", "Shows the latest 50 records. Requested records can be marked paid offline or cancelled.")}</p>
          </div>
        </div>
        {refunds.length > 0 ? (
          <div className="admin-refund-list">
            {refunds.map((refund) => (
              <RefundCard key={refund.id} locale={locale} refund={refund} />
            ))}
          </div>
        ) : (
          <div className="settings-empty">
            <strong>{localeText(locale, "没有退款记录", "No refund records")}</strong>
            <p>{localeText(locale, "可以先创建一条人工退款工单。", "Create a manual refund record first.")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function RefundCard({ locale, refund }: { locale: Locale; refund: RefundRow }) {
  return (
    <article className="admin-refund-card">
      <div className="admin-refund-card-heading">
        <div>
          <span>{refund.user_email}</span>
          <strong>{formatMoney(refund.amount_cents, refund.currency, locale)}</strong>
        </div>
        <b className={`admin-refund-status admin-refund-status-${refund.status}`}>{getRefundStatusLabel(refund.status, locale)}</b>
      </div>
      <div className="settings-kv-grid quota-kv-grid">
        <MiniKv label={localeText(locale, "创建时间", "Created")} value={formatDateTime(refund.created_at, locale, true)} />
        <MiniKv label={localeText(locale, "套餐快照", "Plan snapshot")} value={formatPlanCode(refund.plan_code_snapshot, locale)} />
        <MiniKv label={localeText(locale, "支付线索", "Payment ref")} value={refund.payment_reference || "-"} />
        <MiniKv label={localeText(locale, "线下凭证", "Offline ref")} value={refund.offline_reference || "-"} />
      </div>
      <p>{refund.reason}</p>
      {refund.notes ? <small>{refund.notes}</small> : null}
      <RefundChecklist locale={locale} refund={refund} />
      {refund.status === "requested" ? (
        <div className="admin-refund-actions">
          <form action="/api/admin/manual-refunds" method="post">
            <input name="action" type="hidden" value="mark_paid" />
            <input name="refundId" type="hidden" value={refund.id} />
            <input name="offlineTransferMethod" placeholder={localeText(locale, "打款方式", "Transfer method")} required type="text" />
            <input name="offlineReference" placeholder={localeText(locale, "打款凭证/流水号", "Transfer reference")} required type="text" />
            <button className="button" type="submit">{localeText(locale, "已线下打款", "Mark paid offline")}</button>
          </form>
          <form action="/api/admin/manual-refunds" method="post">
            <input name="action" type="hidden" value="cancel" />
            <input name="refundId" type="hidden" value={refund.id} />
            <input name="notes" placeholder={localeText(locale, "取消原因", "Cancel reason")} type="text" />
            <button className="button button-secondary" type="submit">{localeText(locale, "取消", "Cancel")}</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

async function loadManualRefunds(email: string) {
  try {
    const values: string[] = [];
    const where = email ? "where user_email = $1" : "";
    if (email) values.push(email);
    const result = await query<RefundRow>(
      `
        select
          id,
          user_email,
          amount_cents,
          currency,
          status,
          reason,
          payment_reference,
          offline_transfer_method,
          offline_reference,
          plan_code_snapshot,
          stripe_customer_id_snapshot,
          stripe_subscription_id_snapshot,
          notes,
          subscription_cancelled_at::text,
          gateway_tokens_reviewed_at::text,
          quota_reviewed_at::text,
          user_contacted_at::text,
          paid_at::text,
          created_at::text
        from manual_refunds
        ${where}
        order by created_at desc
        limit 50
      `,
      values,
    );

    return result.rows;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }

    throw error;
  }
}

function RefundChecklist({ locale, refund }: { locale: Locale; refund: RefundRow }) {
  const items = [
    {
      checkedAt: refund.subscription_cancelled_at,
      key: "subscription_cancelled",
      label: localeText(locale, "确认订阅已取消/不再续费", "Confirm subscription cancelled"),
    },
    {
      checkedAt: refund.gateway_tokens_reviewed_at,
      key: "gateway_tokens_reviewed",
      label: localeText(locale, "检查或吊销模型网关令牌", "Review or revoke Gateway tokens"),
    },
    {
      checkedAt: refund.quota_reviewed_at,
      key: "quota_reviewed",
      label: localeText(locale, "检查额度/降级状态", "Review quota or downgrade state"),
    },
    {
      checkedAt: refund.user_contacted_at,
      key: "user_contacted",
      label: localeText(locale, "已联系用户说明退款方式", "Contact user about refund method"),
    },
  ] as const;

  return (
    <div className="admin-refund-checklist">
      {items.map((item) => (
        <form action="/api/admin/manual-refunds" key={item.key} method="post">
          <input name="action" type="hidden" value="checklist" />
          <input name="refundId" type="hidden" value={refund.id} />
          <input name="checklistItem" type="hidden" value={item.key} />
          <span className={item.checkedAt ? "is-done" : undefined}>
            {item.checkedAt ? localeText(locale, "已完成", "Done") : localeText(locale, "待处理", "Pending")} · {item.label}
          </span>
          <button className="button button-secondary" disabled={Boolean(item.checkedAt)} type="submit">
            {item.checkedAt ? localeText(locale, "已完成", "Done") : localeText(locale, "标记", "Mark")}
          </button>
        </form>
      ))}
    </div>
  );
}

function MiniKv({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getRefundStatusLabel(status: RefundRow["status"], locale: Locale) {
  const labels = {
    cancelled: localeText(locale, "已取消", "Cancelled"),
    paid: localeText(locale, "已线下打款", "Paid offline"),
    requested: localeText(locale, "待处理", "Requested"),
  };

  return labels[status];
}

function getNotice(status: string | undefined, locale: Locale) {
  const notices: Record<string, string> = {
    checklist: localeText(locale, "退款检查项已更新。", "Refund checklist updated."),
    cancelled: localeText(locale, "退款工单已取消。", "Refund record cancelled."),
    created: localeText(locale, "退款工单已创建，等待线下打款。", "Refund record created; waiting for offline transfer."),
    paid: localeText(locale, "已记录线下打款。", "Offline payout recorded."),
  };

  return status ? notices[status] || null : null;
}

function normalizeSearchEmail(value: string | undefined) {
  return value ? normalizeEmail(value) : "";
}

function formatMoney(amountCents: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    currency,
    style: "currency",
  }).format(amountCents / 100);
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

function isMissingRelationError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01";
}
