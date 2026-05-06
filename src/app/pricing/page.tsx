import Link from "next/link";
import { getBillingPlans } from "@/lib/billing";
import { getLocale, localeText } from "@/lib/i18n";

export default function PricingPage() {
  const locale = getLocale();
  const plans = getBillingPlans();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "价格", "Pricing")}</div>
        <h1>{localeText(locale, "Sift 智能额度套餐", "Sift Smart Quota Plans")}</h1>
        <p>
          {localeText(
            locale,
            "Sift 默认模型按统一智能额度计量。你也可以使用自定义模型，此时模型费用由你自己的服务商或本地网关承担。",
            "Sift default models are metered through one unified smart quota. You can also use custom models, where model costs are paid directly to your provider or local gateway.",
          )}
        </p>
      </section>

      <section className="public-plan-grid">
        {plans.map((plan) => (
          <div className="public-plan-card" key={plan.code}>
            <span>{plan.name}</span>
            <h2>{plan.priceLabel || localeText(locale, "价格待配置", "Price to be configured")}</h2>
            <strong>{formatCredits(plan.monthlyCredits)} {localeText(locale, "智能额度/月", "smart credits/month")}</strong>
            <p>{plan.description}</p>
            <ul>
              <li>{localeText(locale, "快速保存链接、文本、图片和备注。", "Capture links, text, images, and notes quickly.")}</li>
              <li>{localeText(locale, "后台整理为来源资料和知识页。", "Background processing into sources and wiki pages.")}</li>
              <li>{localeText(locale, "支持全库问答、单页问答和语义检索。", "Whole-library Ask, page Ask, and semantic retrieval.")}</li>
            </ul>
            <Link className="button button-secondary" href="/settings">
              {plan.enabled ? localeText(locale, "在设置中开通", "Subscribe in Settings") : localeText(locale, "查看开通状态", "View availability")}
            </Link>
          </div>
        ))}
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "计费说明", "Billing Notes")}</h2>
        <p>
          {localeText(
            locale,
            "智能额度不是单独出售某个模型，而是覆盖资料处理、图片识别、语义索引、知识问答和检索召回等能力。套餐价格以 Stripe Checkout 页面显示为准。",
            "Smart quota is not a separate charge for a specific model. It covers material processing, image OCR, semantic indexing, Ask, and retrieval. Final subscription prices are shown in Stripe Checkout.",
          )}
        </p>
        <p>
          {localeText(
            locale,
            "正式提交支付审核前，请在部署配置中填写公开展示价格，并保证与 Stripe Checkout 中的订阅价格一致。",
            "Before payment review, configure public price labels and keep them consistent with the subscription prices shown in Stripe Checkout.",
          )}
        </p>
        <p>
          {localeText(
            locale,
            "本地单租户部署可不启用 Stripe。SaaS 托管版本通过 Stripe 处理订阅付款。",
            "Local single-tenant deployments can leave Stripe disabled. Hosted SaaS subscriptions are processed through Stripe.",
          )}
        </p>
      </section>
    </div>
  );
}

function formatCredits(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
