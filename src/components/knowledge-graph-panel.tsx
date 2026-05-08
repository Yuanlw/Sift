import Link from "next/link";
import { localeText, type Locale } from "@/lib/i18n";
import type { KnowledgeGraphNeighbor } from "@/lib/knowledge-graph";
import type { KnowledgeEdgeType } from "@/types/database";

export function KnowledgeGraphPanel({
  locale,
  neighbors,
}: {
  locale: Locale;
  neighbors: KnowledgeGraphNeighbor[];
}) {
  return (
    <div className="panel knowledge-graph-panel">
      <div className="panel-heading">
        <h3>{localeText(locale, "相关资料", "Related graph")}</h3>
        <span className="meta">{localeText(locale, "一跳关系", "1-hop")}</span>
      </div>
      {neighbors.length > 0 ? (
        <div className="knowledge-graph-list">
          {neighbors.map((neighbor) => (
            <Link className={`knowledge-graph-card relation-${neighbor.edgeType}`} href={neighbor.href} key={`${neighbor.type}-${neighbor.id}`}>
              <span className="knowledge-graph-card-top">
                <span className="knowledge-graph-type">{getNodeTypeLabel(neighbor.type, locale)}</span>
                <span className="knowledge-graph-score">{Math.round(neighbor.score * 100)}%</span>
              </span>
              <strong>{neighbor.title}</strong>
              <span className="meta">
                {getEdgeTypeLabel(neighbor.edgeType, locale)}
                {neighbor.confidence !== null ? ` · ${localeText(locale, "置信度", "confidence")} ${Math.round(neighbor.confidence * 100)}%` : ""}
              </span>
              {neighbor.summary ? <small>{toPreview(neighbor.summary)}</small> : null}
            </Link>
          ))}
        </div>
      ) : (
        <p>{localeText(locale, "还没有可展示的关系。继续保存资料后，Sift 会逐步补全关联。", "No visible relations yet. Sift will add links as more material is saved.")}</p>
      )}
    </div>
  );
}

function getNodeTypeLabel(type: KnowledgeGraphNeighbor["type"], locale: Locale) {
  return type === "source" ? localeText(locale, "来源", "Source") : localeText(locale, "知识页", "Wiki");
}

function getEdgeTypeLabel(edgeType: KnowledgeEdgeType, locale: Locale) {
  const labels: Record<KnowledgeEdgeType, { zh: string; en: string }> = {
    contradicts: { zh: "冲突关系", en: "Contradicts" },
    duplicate_source: { zh: "重复来源", en: "Duplicate source" },
    related_wiki: { zh: "相关知识页", en: "Related wiki" },
    source_wiki: { zh: "来源归属", en: "Source-Wiki" },
    supports: { zh: "证据支撑", en: "Supports" },
  };

  return localeText(locale, labels[edgeType].zh, labels[edgeType].en);
}

function toPreview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 150);
}
