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
        <h1>{localeText(locale, "不用自己配模型的知识库订阅", "Knowledge subscriptions without model setup")}</h1>
        <p>
          {localeText(
            locale,
            "个人订阅默认使用 Sift 模型网关，把模型、API 密钥和供应商复杂度藏到后台。高级用户仍可切换到本地模型或自带密钥。",
            "Personal subscriptions use the Sift Model Gateway by default, hiding model, API key, and provider complexity. Advanced users can still switch to local models or BYOK.",
          )}
        </p>
      </section>

      <section className="public-plan-grid">
        {plans.map((plan) => {
          const copy = getPlanCopy(plan.code, locale);

          return (
          <div className="public-plan-card" key={plan.code}>
            <span>{copy.audience}</span>
            <h2>{plan.priceLabel || localeText(locale, "价格待配置", "Price to be configured")}</h2>
            <strong>{getPlanName(plan.code, locale)} · {formatCredits(plan.monthlyCredits, locale)} {localeText(locale, "智能额度/月", "smart credits/month")}</strong>
            <p>{copy.description}</p>
            <ul>
              {copy.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Link className="button button-secondary" href="/settings">
              {plan.enabled ? localeText(locale, "在设置中开通", "Subscribe in Settings") : localeText(locale, "查看开通状态", "View availability")}
            </Link>
          </div>
          );
        })}
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "计费说明", "Billing Notes")}</h2>
        <p>
          {localeText(
            locale,
            "智能额度不是单独出售某个模型，而是覆盖资料处理、图片识别、语义索引、知识问答和检索召回等能力。用户不需要知道底层供应商或 API 密钥。",
            "Smart quota is not a separate charge for a specific model. It covers material processing, image OCR, semantic indexing, Ask, and retrieval. Users do not need to know the underlying provider or API key.",
          )}
        </p>
        <p>
          {localeText(
            locale,
            "本地运行可以继续使用 Sift 模型网关，也可以切换到本地模型或自带 API 密钥。使用 Sift 模型网关时，待处理内容会发送到云端模型服务。",
            "Local deployments can keep using the Sift Gateway, or switch to local models or BYOK. When using the Sift Gateway, content is sent to the cloud model service for processing.",
          )}
        </p>
        <p>
          {localeText(
            locale,
            "套餐价格以支付页面显示为准。本地单租户部署可不启用支付系统；SaaS 托管版本通过支付系统处理订阅付款。",
            "Final subscription prices are shown in Stripe Checkout. Local single-tenant deployments can leave Stripe disabled; hosted SaaS subscriptions are processed through Stripe.",
          )}
        </p>
      </section>
    </div>
  );
}

function formatCredits(value: number, locale: ReturnType<typeof getLocale>) {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(value);
}

function getPlanName(code: string, locale: ReturnType<typeof getLocale>) {
  const names: Record<string, string> = {
    personal: localeText(locale, "个人版", "Personal"),
    pro: localeText(locale, "专业版", "Pro"),
    team: localeText(locale, "团队版", "Team"),
  };

  return names[code] || code;
}

function getPlanCopy(code: string, locale: ReturnType<typeof getLocale>) {
  const plans = {
    personal: {
      audience: localeText(locale, "个人日常使用", "For personal daily use"),
      description: localeText(locale, "给每天保存链接、截图、笔记并希望直接问知识库的人。默认使用 Sift 模型能力，不需要自己配置 API 密钥。", "For people who save links, screenshots, and notes every day and want to ask their knowledge base directly. Uses Sift model capacity by default, with no API key setup."),
      features: [
        localeText(locale, "省心模型额度，开箱即用。", "Hassle-free model quota, ready out of the box."),
        localeText(locale, "快速保存，并在后台整理为来源资料和知识页。", "Fast capture with background Source and Wiki generation."),
        localeText(locale, "适合个人研究、写作、阅读和资料回看。", "Suited for personal research, writing, reading, and review."),
      ],
    },
    pro: {
      audience: localeText(locale, "重度知识工作者", "For heavy knowledge work"),
      description: localeText(locale, "给大量导入资料、经常识别截图、频繁问答和调用 Agent 上下文的用户。", "For users who import heavily, OCR screenshots often, Ask frequently, and use Agent Context."),
      features: [
        localeText(locale, "更高智能额度，适合批量处理。", "Higher smart quota for heavier processing."),
        localeText(locale, "覆盖图片识别、语义索引和高频问答。", "Covers image OCR, semantic indexing, and frequent Ask."),
        localeText(locale, "保留本地模型 / 自带密钥高级选项。", "Keeps local model / BYOK options for advanced control."),
      ],
    },
    team: {
      audience: localeText(locale, "团队与内部部署", "For teams and internal rollout"),
      description: localeText(locale, "给需要共享额度、成员管理、审计和支持的团队。当前先按账户开通，后续扩展工作区共享额度。", "For teams that need shared quota, member management, audit, and support. Currently account-based, with workspace shared quota planned."),
      features: [
        localeText(locale, "为共享额度和管理员控制预留。", "Prepared for shared quota and admin controls."),
        localeText(locale, "适合内部知识库和团队 Agent 上下文底座。", "Suited for internal knowledge bases and team Agent context."),
        localeText(locale, "可走企业自有模型网关或私有部署。", "Can use a company model gateway or private deployment."),
      ],
    },
  };

  return plans[code as keyof typeof plans] || plans.personal;
}
