import { getLocale, localeText } from "@/lib/i18n";
import { getPublicSiteConfig } from "@/lib/site-config";

export default function RefundPage() {
  const locale = getLocale();
  const site = getPublicSiteConfig();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "退款政策", "Refund Policy")}</div>
        <h1>{localeText(locale, "退款政策", "Refund Policy")}</h1>
        <p>{localeText(locale, "更新日期：2026 年 5 月 6 日", "Last updated: May 6, 2026")}</p>
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "订阅计费", "Subscription Billing")}</h2>
        <p>
          {localeText(
            locale,
            "Sift 托管订阅通过支付平台计费。套餐价格、计费周期和付款方式以开通页面展示为准。",
            "Sift hosted subscriptions are billed through Stripe. Subscription prices, billing period, and payment method details are shown during Checkout.",
          )}
        </p>
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "退款窗口", "Refund Window")}</h2>
        <p>
          {localeText(
            locale,
            "首次付费订阅后 7 天内，如果你对服务不满意，可以联系我们申请退款。我们会结合使用量、账号状态和申请理由判断是否符合退款条件。",
            "If you are not satisfied with a first-time paid subscription, contact us within 7 days of the initial payment. We may issue a refund when usage is reasonable and the request appears to be made in good faith.",
          )}
        </p>
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "退款方式", "Refund Method")}</h2>
        <p>
          {localeText(
            locale,
            "审核通过的退款可能通过人工线下方式处理，不承诺原路退回。核对账号和付款记录后，我们可以通过银行转账或双方确认的其他方式完成退款。",
            "Approved refunds may be handled manually and offline. A refund is not guaranteed to be returned through the original payment route; we may arrange a bank transfer or another agreed payout method after verifying the account and payment record.",
          )}
        </p>
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "不适用退款的情况", "Non-Refundable Usage")}</h2>
        <p>
          {localeText(
            locale,
            "大量模型消耗、滥用、欺诈、恶意拒付、违反服务条款，或因过量默认模型处理已经产生明显成本的情况，可能不支持退款。",
            "Heavy model usage, abuse, fraud, chargeback abuse, violation of the Terms of Service, or costs already incurred through excessive default-model processing may be non-refundable.",
          )}
        </p>
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "取消订阅", "Cancellation")}</h2>
        <p>
          {localeText(
            locale,
            "取消订阅会停止后续续费，但不会自动退还当前计费周期费用。除法律另有要求外，当前周期内的访问权限和额度可能会保留到周期结束。",
            "Canceling a subscription stops future renewals but does not automatically refund the current billing period. Access and quota may remain available until the end of the paid period unless otherwise required by law.",
          )}
        </p>
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "联系我们", "Contact")}</h2>
        <p>
          {localeText(
            locale,
            `申请退款时，请联系 ${site.contactEmail}，并提供账号邮箱、付款日期和退款原因。`,
            `For refund requests, contact ${site.contactEmail} with your account email, payment date, and reason for the request.`,
          )}
        </p>
      </section>
    </div>
  );
}
