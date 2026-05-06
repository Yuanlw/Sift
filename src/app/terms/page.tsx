import { getLocale, localeText } from "@/lib/i18n";
import { getPublicSiteConfig } from "@/lib/site-config";

export default function TermsPage() {
  const locale = getLocale();
  const site = getPublicSiteConfig();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "服务条款", "Terms of Service")}</div>
        <h1>Terms of Service</h1>
        <p>Last updated: May 6, 2026</p>
      </section>

      <LegalSection
        title="Service"
        body={[
          "Sift is a capture-first personal knowledge base that helps users save links, text, images, and notes, then organize them into sources, wiki pages, retrieval context, and question-answering workflows.",
          "The hosted service may include default model processing, smart quota, subscriptions, and billing features.",
        ]}
      />
      <LegalSection
        title="Your Responsibilities"
        body={[
          "You are responsible for the content you save into Sift and for ensuring you have the right to process it.",
          "You may not use Sift for unlawful content, abusive automation, spam, payment fraud, credential theft, or attempts to bypass third-party rights or access controls.",
        ]}
      />
      <LegalSection
        title="Subscriptions and Smart Quota"
        body={[
          "Hosted default models consume smart quota. Custom model mode does not consume Sift smart quota, but you are responsible for costs charged by your own model provider.",
          "Subscription plan details, quota amounts, renewal timing, and prices are shown during Stripe Checkout and in the settings page when available.",
        ]}
      />
      <LegalSection
        title="Availability"
        body={[
          "Sift is provided on a commercially reasonable basis. We may update, suspend, limit, or discontinue parts of the service to protect reliability, security, compliance, or product quality.",
          "Background processing can be delayed by model availability, quota limits, large imports, or provider failures. Raw capture should remain the first priority.",
        ]}
      />
      <LegalSection
        title="Intellectual Property"
        body={[
          "You retain rights to your own content. Sift retains rights to the software, product design, service infrastructure, documentation, and trademarks.",
          "The source-available project license governs self-hosted use and restrictions on offering Sift or substantially similar hosted derivatives.",
        ]}
      />
      <LegalSection
        title="Contact"
        body={[`For terms or service questions, contact ${site.contactEmail}.`]}
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
