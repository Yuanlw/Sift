import Link from "next/link";
import { redirect } from "next/navigation";
import { CaptureFormContent } from "@/components/capture-form";
import { getServerEnv } from "@/lib/env";
import { getLocale, localeText } from "@/lib/i18n";
import { recordProductEvent } from "@/lib/product-events";
import { getOptionalUserContextFromHeaders } from "@/lib/user-context";

export default async function MobileCapturePage({
  searchParams,
}: {
  searchParams?: {
    note?: string;
    source?: string;
    text?: string;
    title?: string;
    url?: string;
  };
}) {
  const locale = getLocale();
  const env = getServerEnv();
  const userContext = await getOptionalUserContextFromHeaders();

  if (env.SIFT_REQUIRE_AUTH && userContext?.source !== "session" && userContext?.source !== "trusted_header") {
    redirect(`/login?next=${encodeURIComponent(buildCaptureNext(searchParams))}`);
  }

  const initialContent = buildInitialContent(searchParams);
  const initialNote = normalizeQueryValue(searchParams?.note);
  const sourceApp = normalizeSourceValue(searchParams?.source) || "mobile_capture";

  await recordProductEvent({
    eventName: "capture.entry.viewed",
    metadata: {
      has_prefill: Boolean(initialContent || initialNote),
      source_app: sourceApp,
    },
    resourceType: "capture_entry",
    source: sourceApp,
    userId: userContext?.userId || null,
  });

  return (
    <div className="mobile-capture-page">
      <section className="mobile-capture-hero">
        <div>
          <div className="eyebrow">{localeText(locale, "手机快存", "Quick Capture")}</div>
          <h1>{localeText(locale, "先丢进来", "Save It First")}</h1>
          <p>
            {localeText(
              locale,
              "链接、截图、复制正文和临时想法都可以先保存。Sift 会先落库，再后台整理。",
              "Links, screenshots, copied text, and quick thoughts can be saved first. Sift stores them immediately, then processes in the background.",
            )}
          </p>
        </div>
        <Link className="button button-secondary" href="/inbox">
          {localeText(locale, "看今日收集", "View Today")}
        </Link>
      </section>

      <CaptureFormContent
        initialContent={initialContent}
        initialNote={initialNote}
        locale={locale}
        redirectTo="/inbox?view=today"
        sourceApp={sourceApp}
      />

      <section className="mobile-capture-notes" aria-label={localeText(locale, "快存说明", "Quick capture notes")}>
        <div>
          <strong>{localeText(locale, "从手机分享", "Share from mobile")}</strong>
          <p>{localeText(locale, "浏览器、稍后读、聊天和内容平台可以先复制链接或正文，再打开这里保存。", "Copy a link or text from browsers, read-it-later apps, chats, or content platforms, then open this page to save it.")}</p>
        </div>
        <div>
          <strong>{localeText(locale, "截图也可以", "Screenshots work")}</strong>
          <p>{localeText(locale, "上传一张或多张截图，后续 OCR 和整理失败也不会丢原图。", "Upload one or more screenshots. Even if OCR or processing fails later, the original images are preserved.")}</p>
        </div>
        <div>
          <strong>{localeText(locale, "不当场分类", "No filing required")}</strong>
          <p>{localeText(locale, "保存时不要求标签和目录；Inbox 按时间管理，Wiki 后台再按主题沉淀。", "No tags or folders are required at save time. Inbox is time-based; Wiki organization happens later.")}</p>
        </div>
      </section>
    </div>
  );
}

function buildInitialContent(searchParams: { text?: string; title?: string; url?: string } | undefined) {
  const title = normalizeQueryValue(searchParams?.title);
  const text = normalizeQueryValue(searchParams?.text);
  const url = normalizeQueryValue(searchParams?.url);

  return [title, url, text].filter(Boolean).join("\n\n");
}

function normalizeQueryValue(value: string | undefined) {
  return typeof value === "string" ? value.trim().slice(0, 12000) : "";
}

function buildCaptureNext(searchParams: { note?: string; source?: string; text?: string; title?: string; url?: string } | undefined) {
  const params = new URLSearchParams();

  for (const key of ["title", "url", "text", "note", "source"] as const) {
    const value = key === "source" ? normalizeSourceValue(searchParams?.[key]) : normalizeQueryValue(searchParams?.[key]);
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `/capture?${query}` : "/capture";
}

function normalizeSourceValue(value: string | undefined) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_")
    .slice(0, 80);
}
