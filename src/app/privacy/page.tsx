import { getLocale, localeText } from "@/lib/i18n";
import { getPublicSiteConfig } from "@/lib/site-config";

export default function PrivacyPage() {
  const locale = getLocale();
  const site = getPublicSiteConfig();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "隐私政策", "Privacy Policy")}</div>
        <h1>{localeText(locale, "Privacy Policy", "Privacy Policy")}</h1>
        <p>{localeText(locale, "Last updated: May 6, 2026", "Last updated: May 6, 2026")}</p>
      </section>

      <LegalSection
        title="Information We Collect"
        body={[
          "Sift stores the materials you choose to save, including links, text, images, notes, extracted source content, generated wiki pages, search indexes, ask histories, and related metadata.",
          "For hosted accounts, we may also store account identifiers, subscription status, plan information, usage records, and support messages.",
        ]}
      />
      <LegalSection
        title="How We Use Information"
        body={[
          "We use your information to provide capture, processing, retrieval, question answering, billing, support, security, and product improvement features.",
          "Model call logs store metadata such as purpose, role, status, duration, token counts, and endpoint host. They do not store raw prompts, source text, images, or full model outputs.",
        ]}
      />
      <LegalSection
        title="Model Processing"
        body={[
          "If you use Sift default models, your saved content may be processed by model providers used by the hosted service.",
          "If you configure custom models, requests are sent to the endpoint and provider you configure. You are responsible for that provider relationship.",
        ]}
      />
      <LegalSection
        title="Payments"
        body={[
          "Hosted subscriptions are processed by Stripe. Sift does not store full card numbers or payment credentials.",
          "Stripe may process payment and billing information according to its own privacy and security terms.",
        ]}
      />
      <LegalSection
        title="Data Retention and Deletion"
        body={[
          "You can archive or delete saved sources and wiki pages inside the product. Backups and logs may persist for a limited period for security and reliability.",
          `For account deletion or privacy requests, contact ${site.contactEmail}.`,
        ]}
      />
      <LegalSection
        title="Contact"
        body={[`For privacy questions, contact ${site.contactEmail}.`]}
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
