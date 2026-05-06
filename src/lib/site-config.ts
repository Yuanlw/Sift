const fallbackContactEmail = "contact@example.com";

export function getPublicSiteConfig() {
  return {
    businessAddress: normalize(process.env.SIFT_BUSINESS_ADDRESS),
    businessName: normalize(process.env.SIFT_BUSINESS_NAME) || "Sift",
    contactEmail: normalize(process.env.SIFT_CONTACT_EMAIL) || fallbackContactEmail,
    contactEmailIsPlaceholder: !normalize(process.env.SIFT_CONTACT_EMAIL),
  };
}

function normalize(value: string | undefined) {
  return value?.trim() || undefined;
}
