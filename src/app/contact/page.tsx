import { getLocale, localeText } from "@/lib/i18n";
import { getPublicSiteConfig } from "@/lib/site-config";

export default function ContactPage() {
  const locale = getLocale();
  const site = getPublicSiteConfig();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "联系我们", "Contact Us")}</div>
        <h1>{localeText(locale, "联系 Sift", "Contact Sift")}</h1>
        <p>
          {localeText(
            locale,
            "如果你有产品、账单、隐私或商业授权问题，可以通过以下邮箱联系。",
            "For product, billing, privacy, or commercial licensing questions, contact us by email.",
          )}
        </p>
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "邮箱", "Email")}</h2>
        <p>
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        </p>
        {site.contactEmailIsPlaceholder ? (
          <p>
            {localeText(
              locale,
              "上线前请把这个邮箱替换为真实的域名企业邮箱，例如 contact@yourdomain.com。",
              "Before launch, replace this address with a real domain email, such as contact@yourdomain.com.",
            )}
          </p>
        ) : null}
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "服务主体", "Business Information")}</h2>
        <p>{site.businessName}</p>
        {site.businessAddress ? (
          <p>{site.businessAddress}</p>
        ) : (
          <p>
            {localeText(
              locale,
              "SaaS 正式上线和提交支付审核前，请配置真实、稳定、可保持一致的联系地址。",
              "Before hosted launch and payment review, configure a real, stable, and consistent contact address.",
            )}
          </p>
        )}
      </section>

      <section className="legal-section">
        <h2>{localeText(locale, "响应时间", "Response Time")}</h2>
        <p>
          {localeText(
            locale,
            "我们通常会在 3 个工作日内回复。账单、隐私和安全相关问题会优先处理。",
            "We usually respond within 3 business days. Billing, privacy, and security requests are prioritized.",
          )}
        </p>
      </section>
    </div>
  );
}
