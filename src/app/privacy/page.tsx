import { getLocale, localeText } from "@/lib/i18n";
import { getPublicSiteConfig } from "@/lib/site-config";

export default function PrivacyPage() {
  const locale = getLocale();
  const site = getPublicSiteConfig();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "隐私政策", "Privacy Policy")}</div>
        <h1>{localeText(locale, "隐私政策", "Privacy Policy")}</h1>
        <p>{localeText(locale, "更新日期：2026 年 5 月 6 日", "Last updated: May 6, 2026")}</p>
      </section>

      <LegalSection
        title={localeText(locale, "我们收集的信息", "Information We Collect")}
        body={[
          localeText(
            locale,
            "Sift 会保存你主动存入的资料，包括链接、文本、图片、备注、提取后的来源内容、生成的知识页、搜索索引、问答历史和相关元数据。",
            "Sift stores the materials you choose to save, including links, text, images, notes, extracted source content, generated wiki pages, search indexes, ask histories, and related metadata.",
          ),
          localeText(
            locale,
            "对于托管账号，我们还可能保存账号标识、订阅状态、套餐信息、使用记录和支持沟通记录。",
            "For hosted accounts, we may also store account identifiers, subscription status, plan information, usage records, and support messages.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "我们如何使用信息", "How We Use Information")}
        body={[
          localeText(
            locale,
            "我们使用这些信息提供保存、处理、检索、问答、计费、客服支持、安全保护和产品改进等能力。",
            "We use your information to provide capture, processing, retrieval, question answering, billing, support, security, and product improvement features.",
          ),
          localeText(
            locale,
            "模型调用日志只保存用途、角色、状态、耗时、用量和端点主机等元数据，不保存原始提示词、来源正文、图片或完整模型回答。",
            "Model call logs store metadata such as purpose, role, status, duration, token counts, and endpoint host. They do not store raw prompts, source text, images, or full model outputs.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "模型处理", "Model Processing")}
        body={[
          localeText(
            locale,
            "如果你使用 Sift 默认模型，你保存的内容可能会被托管服务使用的模型服务处理。",
            "If you use Sift default models, your saved content may be processed by model providers used by the hosted service.",
          ),
          localeText(
            locale,
            "如果你配置自定义模型，请求会发送到你配置的端点和供应商；你需要自行负责与该供应商的关系。",
            "If you configure custom models, requests are sent to the endpoint and provider you configure. You are responsible for that provider relationship.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "付款", "Payments")}
        body={[
          localeText(
            locale,
            "托管订阅由支付平台处理。Sift 不保存完整银行卡号或支付凭据。",
            "Hosted subscriptions are processed by Stripe. Sift does not store full card numbers or payment credentials.",
          ),
          localeText(
            locale,
            "支付平台会按照其自身隐私和安全条款处理付款与账单信息。",
            "Stripe may process payment and billing information according to its own privacy and security terms.",
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "数据保留与删除", "Data Retention and Deletion")}
        body={[
          localeText(
            locale,
            "你可以在产品内归档或删除已保存的来源资料和知识页。出于安全和可靠性需要，备份和日志可能会在有限时间内保留。",
            "You can archive or delete saved sources and wiki pages inside the product. Backups and logs may persist for a limited period for security and reliability.",
          ),
          localeText(
            locale,
            `如需删除账号或提交隐私请求，请联系 ${site.contactEmail}。`,
            `For account deletion or privacy requests, contact ${site.contactEmail}.`,
          ),
        ]}
      />
      <LegalSection
        title={localeText(locale, "联系我们", "Contact")}
        body={[localeText(locale, `隐私相关问题请联系 ${site.contactEmail}。`, `For privacy questions, contact ${site.contactEmail}.`)]}
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
