import Link from "next/link";
import { KnowledgeDiscoveryActions } from "@/components/knowledge-discovery-actions";
import { KnowledgeRecommendationActions } from "@/components/knowledge-recommendation-actions";
import { localeText, type Locale } from "@/lib/i18n";
import type { KnowledgeDiscoveryView } from "@/lib/knowledge-discoveries";
import type { KnowledgeRecommendationView } from "@/lib/knowledge-recommendations";

export function KnowledgeDiscoveryPanel({
  discoveries,
  emptyMessage,
  locale,
  recommendations = [],
  showEmpty = false,
  summaryItems = [],
  variant = "default",
}: {
  discoveries: KnowledgeDiscoveryView[];
  emptyMessage?: string;
  locale: Locale;
  recommendations?: KnowledgeRecommendationView[];
  showEmpty?: boolean;
  summaryItems?: Array<{
    href?: string;
    label: string;
    value: string;
  }>;
  variant?: "default" | "compact";
}) {
  if (discoveries.length === 0 && !showEmpty) {
    return null;
  }

  return (
    <section
      className={`knowledge-discovery-panel knowledge-discovery-panel-${variant}`}
      id="discoveries"
      aria-label={localeText(locale, "待处理发现", "Discoveries to review")}
    >
      <div className="section-heading">
        <div>
          <div className="eyebrow">{localeText(locale, "近期回顾", "Recent review")}</div>
          <h2>{localeText(locale, "知识库今天发生了什么", "What changed today")}</h2>
        </div>
        <span className="meta">
          {localeText(locale, "待处理发现", "Discoveries")} · {discoveries.length}
        </span>
      </div>

      {summaryItems.length > 0 ? (
        <div className="today-review-grid">
          {summaryItems.map((item) =>
            item.href ? (
              <Link className="today-review-stat" href={item.href} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </Link>
            ) : (
              <div className="today-review-stat" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ),
          )}
        </div>
      ) : null}

      {recommendations.length > 0 ? (
        <div className="today-review-recent">
          <div className="today-review-subhead">
            <strong>{localeText(locale, "值得回看", "Worth revisiting")}</strong>
            <span className="meta">{localeText(locale, "根据最近新增内容和全库关联", "Based on new captures and library links")}</span>
          </div>
          <div className="today-review-source-list">
            {recommendations.map((recommendation) => (
              <article className="today-review-source" key={recommendation.id}>
                <Link className="today-review-source-link" href={`/sources/${recommendation.source.id}`}>
                  <strong>{recommendation.source.title}</strong>
                  <span>{recommendation.reason}</span>
                  {recommendation.source.summary ? <small>{recommendation.source.summary.slice(0, 120)}</small> : null}
                </Link>
                <KnowledgeRecommendationActions locale={locale} recommendationId={recommendation.id} />
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="today-review-subhead">
        <strong>{localeText(locale, "待处理发现", "Discoveries to review")}</strong>
        <span className="meta">{localeText(locale, "只显示可处理项", "Actionable only")}</span>
      </div>
      <div className="knowledge-discovery-list">
        {discoveries.length === 0 ? (
          <div className="knowledge-discovery-empty">
            <strong>{localeText(locale, "今天暂时没有需要处理的发现", "No discoveries need review today")}</strong>
            <span className="meta">
              {emptyMessage ||
                localeText(
                  locale,
                  "有新的关联、重复或可更新知识页时，这里会出现处理入口。",
                  "When Sift finds related, duplicate, or updatable knowledge, it will appear here.",
                )}
            </span>
          </div>
        ) : discoveries.map((item) => (
          <article className={`knowledge-discovery-row discovery-${item.type}`} key={item.id}>
            <div className="knowledge-discovery-type">{getDiscoveryTypeLabel(item.type, locale)}</div>
            <div className="knowledge-discovery-main">
              <strong>{getDiscoveryTitle(item, locale)}</strong>
              <p>{item.body}</p>
              {item.suggestedQuestion ? (
                <span className="suggested-question-inline">
                  {localeText(locale, "可追问", "Ask")}：{item.suggestedQuestion}
                </span>
              ) : null}
            </div>
            <div className="knowledge-discovery-links">
              {item.source ? (
                <Link href={`/sources/${item.source.id}`}>
                  {localeText(locale, "新资料", "New")}
                </Link>
              ) : null}
              {item.relatedSource ? (
                <Link href={`/sources/${item.relatedSource.id}`}>
                  {localeText(locale, "比较旧资料", "Compare")}
                </Link>
              ) : null}
              {item.relatedWikiPage ? (
                <Link href={`/wiki/${encodeURIComponent(item.relatedWikiPage.slug)}`}>
                  {localeText(locale, "查看知识页", "Open wiki")}
                </Link>
              ) : null}
              <KnowledgeDiscoveryActions discoveryId={item.id} locale={locale} type={item.type} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function getDiscoveryTypeLabel(type: KnowledgeDiscoveryView["type"], locale: Locale) {
  const labels: Record<KnowledgeDiscoveryView["type"], string> = {
    new_source: localeText(locale, "新资料", "New source"),
    related_wiki: localeText(locale, "可更新", "Update"),
    duplicate_source: localeText(locale, "疑似重复", "Duplicate"),
    suggested_question: localeText(locale, "建议问题", "Suggested question"),
  };

  return labels[type];
}

function getDiscoveryTitle(item: KnowledgeDiscoveryView, locale: Locale) {
  if (item.type === "related_wiki" && item.relatedWikiPage) {
    return localeText(locale, `可能更新「${item.relatedWikiPage.title}」`, `May update "${item.relatedWikiPage.title}"`);
  }

  if (item.type === "duplicate_source" && item.relatedSource) {
    return localeText(locale, `可能和「${item.relatedSource.title}」重复`, `May duplicate "${item.relatedSource.title}"`);
  }

  return item.title;
}
