import { getLocale, localeText } from "@/lib/i18n";
import { getPublicSiteConfig } from "@/lib/site-config";

export default function RefundPage() {
  const locale = getLocale();
  const site = getPublicSiteConfig();

  return (
    <div className="legal-page">
      <section className="hero legal-hero">
        <div className="eyebrow">{localeText(locale, "退款政策", "Refund Policy")}</div>
        <h1>Refund Policy</h1>
        <p>Last updated: May 6, 2026</p>
      </section>

      <section className="legal-section">
        <h2>Subscription Billing</h2>
        <p>
          Sift hosted subscriptions are billed through Stripe. Subscription prices, billing period, and payment method details are shown during Checkout.
        </p>
      </section>

      <section className="legal-section">
        <h2>Refund Window</h2>
        <p>
          If you are not satisfied with a first-time paid subscription, contact us within 7 days of the initial payment. We may issue a refund when usage is reasonable and the request appears to be made in good faith.
        </p>
      </section>

      <section className="legal-section">
        <h2>Non-Refundable Usage</h2>
        <p>
          Heavy model usage, abuse, fraud, chargeback abuse, violation of the Terms of Service, or costs already incurred through excessive default-model processing may be non-refundable.
        </p>
      </section>

      <section className="legal-section">
        <h2>Cancellation</h2>
        <p>
          Canceling a subscription stops future renewals but does not automatically refund the current billing period. Access and quota may remain available until the end of the paid period unless otherwise required by law.
        </p>
      </section>

      <section className="legal-section">
        <h2>Contact</h2>
        <p>For refund requests, contact {site.contactEmail} with your account email, payment date, and reason for the request.</p>
      </section>
    </div>
  );
}
