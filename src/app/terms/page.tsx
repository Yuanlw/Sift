import { getLocale, localeText } from "@/lib/i18n";
import { getPublicSiteConfig } from "@/lib/site-config";

export default function TermsPage() {
  const locale = getLocale();
  const site = getPublicSiteConfig();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "服务条款", "Terms of Service")}</div>
        <h1>{localeText(locale, "服务条款", "Terms of Service")}</h1>
        <p>{localeText(locale, "更新日期：2026 年 5 月 6 日", "Last updated: May 6, 2026")}</p>
      </section>

      <LegalSection
        title={localeText(locale, "服务内容", "Service")}
        body={[
          localeText(
            locale,
            "Sift 是一个先保存、再沉淀的个人知识库，帮助用户保存链接、文本、图片和备注，并整理为来源资料、知识页、检索上下文和问答流程。",
            "Sift is a capture-first personal knowledge base that helps users save links, text, images, and notes, then organize them into sources, wiki pages, retrieval context, and question-answering workflows.",
          ),
          localeText(
            locale,
            "托管服务可能包含默认模型处理、智能额度、订阅和计费能力。",
            "The hosted service may include default model processing, smart quota, subscriptions, and billing features.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "你的责任", "Your Responsibilities")}
        body={[
          localeText(
            locale,
            "你需要对自己保存到 Sift 的内容负责，并确保你有权处理这些内容。",
            "You are responsible for the content you save into Sift and for ensuring you have the right to process it.",
          ),
          localeText(
            locale,
            "你不得将 Sift 用于违法内容、滥用自动化、垃圾信息、支付欺诈、凭据窃取，或绕过第三方权利和访问控制。",
            "You may not use Sift for unlawful content, abusive automation, spam, payment fraud, credential theft, or attempts to bypass third-party rights or access controls.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "订阅与智能额度", "Subscriptions and Smart Quota")}
        body={[
          localeText(
            locale,
            "托管默认模型会消耗智能额度。自定义模型模式不消耗 Sift 智能额度，但你需要自行承担自有模型服务产生的费用。",
            "Hosted default models consume smart quota. Custom model mode does not consume Sift smart quota, but you are responsible for costs charged by your own model provider.",
          ),
          localeText(
            locale,
            "订阅套餐、额度、续费时间和价格以开通页面及设置页展示为准。",
            "Subscription plan details, quota amounts, renewal timing, and prices are shown during Stripe Checkout and in the settings page when available.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "可用性", "Availability")}
        body={[
          localeText(
            locale,
            "Sift 会以商业上合理的方式提供服务。为保护可靠性、安全、合规或产品质量，我们可能更新、暂停、限制或停止部分能力。",
            "Sift is provided on a commercially reasonable basis. We may update, suspend, limit, or discontinue parts of the service to protect reliability, security, compliance, or product quality.",
          ),
          localeText(
            locale,
            "后台处理可能因模型可用性、额度限制、大批量导入或供应商故障而延迟。原始资料保存仍应是第一优先级。",
            "Background processing can be delayed by model availability, quota limits, large imports, or provider failures. Raw capture should remain the first priority.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "知识产权", "Intellectual Property")}
        body={[
          localeText(
            locale,
            "你保留自己内容的权利。Sift 保留软件、产品设计、服务基础设施、文档和商标相关权利。",
            "You retain rights to your own content. Sift retains rights to the software, product design, service infrastructure, documentation, and trademarks.",
          ),
          localeText(
            locale,
            "源码可见项目许可证适用于自托管使用，以及对提供 Sift 或实质相似托管衍生服务的限制。",
            "The source-available project license governs self-hosted use and restrictions on offering Sift or substantially similar hosted derivatives.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "联系我们", "Contact")}
        body={[localeText(locale, `条款或服务相关问题请联系 ${site.contactEmail}。`, `For terms or service questions, contact ${site.contactEmail}.`)]}
      />
    </div>
  );
}

function LegalSection({ body, title }: { body: string[]; title: string }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </section>
  );
}
