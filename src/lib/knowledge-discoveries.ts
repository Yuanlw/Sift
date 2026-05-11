import { query } from "@/lib/db";
import {
  loadDuplicateSourceSuggestions,
  loadSimilarWikiPageSuggestions,
} from "@/lib/reuse-suggestions";
import type {
  Json,
  KnowledgeDiscovery,
  KnowledgeDiscoveryType,
  Source,
  WikiPage,
} from "@/types/database";

export interface KnowledgeDiscoveryView {
  id: string;
  type: KnowledgeDiscoveryType;
  title: string;
  body: string;
  suggestedQuestion: string | null;
  createdAt: string;
  source: { id: string; title: string } | null;
  wikiPage: { id: string; title: string; slug: string } | null;
  relatedSource: { id: string; title: string } | null;
  relatedWikiPage: { id: string; title: string; slug: string } | null;
  mergeEligibility: MergeEligibility;
}

export interface MergeEligibility {
  canMerge: boolean;
  reason: string;
  score: number | null;
  strength: "strong" | "weak";
}

interface KnowledgeDiscoveryRow {
  id: string;
  discovery_type: KnowledgeDiscoveryType;
  title: string;
  body: string;
  metadata: Json;
  suggested_question: string | null;
  created_at: string;
  source_id: string | null;
  source_title: string | null;
  wiki_page_id: string | null;
  wiki_title: string | null;
  wiki_slug: string | null;
  related_source_id: string | null;
  related_source_title: string | null;
  related_wiki_page_id: string | null;
  related_wiki_title: string | null;
  related_wiki_slug: string | null;
}

interface DiscoveryInput {
  userId: string;
  source: Source;
  wikiPage: WikiPage;
}

interface DiscoveryDraft {
  type: KnowledgeDiscoveryType;
  title: string;
  body: string;
  sourceId?: string | null;
  wikiPageId?: string | null;
  relatedSourceId?: string | null;
  relatedWikiPageId?: string | null;
  suggestedQuestion?: string | null;
  metadata?: Json;
  dedupeKey: string;
}

export async function createKnowledgeDiscoveriesForProcessedCapture(input: DiscoveryInput) {
  const [duplicateSources, similarWikiPages] = await Promise.all([
    loadDuplicateSourceSuggestions({
      userId: input.userId,
      sourceId: input.source.id,
      limit: 2,
    }).catch(() => []),
    loadSimilarWikiPageSuggestions({
      userId: input.userId,
      wikiPageId: input.wikiPage.id,
      limit: 3,
    }).catch(() => []),
  ]);

  const drafts: DiscoveryDraft[] = [];

  for (const suggestion of similarWikiPages) {
    const mergeEligibility = evaluateMergeEligibility("related_wiki", {
      reasons: suggestion.reasons,
      score: suggestion.score,
    });
    drafts.push({
      type: "related_wiki",
      title: suggestion.title,
      body: mergeEligibility.canMerge
        ? `新资料「${input.source.title}」可能补充这页：${suggestion.reasons.join(" / ")}。`
        : `新资料「${input.source.title}」和这页可能相关，但还不足以直接合并：${suggestion.reasons.join(" / ")}。`,
      sourceId: input.source.id,
      wikiPageId: input.wikiPage.id,
      relatedWikiPageId: suggestion.wikiPageId,
      suggestedQuestion: mergeEligibility.canMerge
        ? `这条新资料会如何更新「${suggestion.title}」？`
        : `这条新资料和「${suggestion.title}」具体相似在哪里、差异在哪里？`,
      metadata: {
        mergeable: mergeEligibility.canMerge,
        score: suggestion.score,
        reasons: suggestion.reasons,
        related_slug: suggestion.slug,
      },
      dedupeKey: `source:${input.source.id}:related-wiki:${suggestion.wikiPageId}`,
    });
  }

  for (const suggestion of duplicateSources) {
    const mergeEligibility = evaluateMergeEligibility("duplicate_source", {
      reasons: suggestion.reasons,
      score: suggestion.score,
    });
    drafts.push({
      type: "duplicate_source",
      title: suggestion.title,
      body: `新资料「${input.source.title}」和这条旧资料相似：${suggestion.reasons.join(" / ")}。`,
      sourceId: input.source.id,
      wikiPageId: input.wikiPage.id,
      relatedSourceId: suggestion.sourceId,
      suggestedQuestion: `这两份资料有哪些重复和差异？`,
      metadata: {
        mergeable: mergeEligibility.canMerge,
        score: suggestion.score,
        reasons: suggestion.reasons,
        original_url: suggestion.originalUrl,
      },
      dedupeKey: `source:${input.source.id}:duplicate-source:${suggestion.sourceId}`,
    });
  }

  for (const draft of drafts.slice(0, 5)) {
    await upsertKnowledgeDiscovery(input.userId, draft);
  }
}

export async function loadKnowledgeDiscoveries(input: {
  userId: string;
  limit?: number;
}): Promise<KnowledgeDiscoveryView[]> {
  const result = await query<KnowledgeDiscoveryRow>(
    `
      select
        kd.id,
        kd.discovery_type,
        kd.title,
        kd.body,
        kd.metadata,
        kd.suggested_question,
        kd.created_at,
        s.id as source_id,
        s.title as source_title,
        wp.id as wiki_page_id,
        wp.title as wiki_title,
        wp.slug as wiki_slug,
        rs.id as related_source_id,
        rs.title as related_source_title,
        rwp.id as related_wiki_page_id,
        rwp.title as related_wiki_title,
        rwp.slug as related_wiki_slug
      from knowledge_discoveries kd
      left join sources s on s.id = kd.source_id and s.user_id = kd.user_id
      left join captures c on c.id = s.capture_id
      left join wiki_pages wp on wp.id = kd.wiki_page_id and wp.user_id = kd.user_id and wp.status <> 'archived'
      left join sources rs on rs.id = kd.related_source_id and rs.user_id = kd.user_id
      left join captures rc on rc.id = rs.capture_id
      left join wiki_pages rwp on rwp.id = kd.related_wiki_page_id and rwp.user_id = kd.user_id and rwp.status <> 'archived'
      where kd.user_id = $1
        and kd.status <> 'ignored'
        and kd.discovery_type in ('related_wiki', 'duplicate_source')
        and (s.id is null or c.status is null or c.status <> 'ignored')
        and (rs.id is null or rc.status is null or rc.status <> 'ignored')
        and (kd.wiki_page_id is null or wp.id is not null)
        and (kd.related_wiki_page_id is null or rwp.id is not null)
      order by kd.created_at desc
      limit $2
    `,
    [input.userId, input.limit || 6],
  );

  return result.rows.map((row) => {
    const mergeEligibility = evaluateMergeEligibility(row.discovery_type, row.metadata);

    return {
      id: row.id,
      type: row.discovery_type,
      title: row.title,
      body: row.body,
      suggestedQuestion: row.suggested_question,
      createdAt: row.created_at,
      mergeEligibility,
      source: row.source_id && row.source_title ? { id: row.source_id, title: row.source_title } : null,
      wikiPage:
        row.wiki_page_id && row.wiki_title && row.wiki_slug
          ? { id: row.wiki_page_id, title: row.wiki_title, slug: row.wiki_slug }
          : null,
      relatedSource:
        row.related_source_id && row.related_source_title
          ? { id: row.related_source_id, title: row.related_source_title }
          : null,
      relatedWikiPage:
        row.related_wiki_page_id && row.related_wiki_title && row.related_wiki_slug
          ? { id: row.related_wiki_page_id, title: row.related_wiki_title, slug: row.related_wiki_slug }
          : null,
    };
  });
}

export function evaluateMergeEligibility(type: KnowledgeDiscoveryType, metadata: Json): MergeEligibility {
  const data = getJsonObject(metadata);
  const score = typeof data.score === "number" ? data.score : null;
  const reasons = Array.isArray(data.reasons) ? data.reasons.filter((reason): reason is string => typeof reason === "string") : [];
  const hasReason = (pattern: RegExp) => reasons.some((reason) => pattern.test(reason));
  const semanticOnly = reasons.length > 0 && reasons.every((reason) => /语义相似/.test(reason));

  if (type === "duplicate_source") {
    const strongDuplicate = hasReason(/原始链接相同|正文重复度高/);
    const strongScore = score !== null && score >= 0.75 && !semanticOnly;

    return {
      canMerge: strongDuplicate || strongScore,
      reason: strongDuplicate ? "重复证据较强" : strongScore ? "重复分数较高" : "相似度不足以合并",
      score,
      strength: strongDuplicate || strongScore ? "strong" : "weak",
    };
  }

  if (type === "related_wiki") {
    const titleOverlap = hasReason(/标题相近|标题高度相似/);
    const topicOverlap = hasReason(/内容主题相似/);
    const enoughCorroboration = titleOverlap && topicOverlap && score !== null && score >= 0.55;

    return {
      canMerge: enoughCorroboration,
      reason: enoughCorroboration ? "标题和正文主题都有足够交叉" : "仅相关，不适合直接合并",
      score,
      strength: enoughCorroboration ? "strong" : "weak",
    };
  }

  return {
    canMerge: false,
    reason: "不是合并型发现",
    score,
    strength: "weak",
  };
}

function getJsonObject(value: Json) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function upsertKnowledgeDiscovery(userId: string, draft: DiscoveryDraft) {
  await query<KnowledgeDiscovery>(
    `
      insert into knowledge_discoveries (
        user_id,
        discovery_type,
        title,
        body,
        source_id,
        wiki_page_id,
        related_source_id,
        related_wiki_page_id,
        suggested_question,
        metadata,
        dedupe_key
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      on conflict (user_id, dedupe_key)
      do update set
        title = excluded.title,
        body = excluded.body,
        suggested_question = excluded.suggested_question,
        metadata = excluded.metadata,
        status = 'new',
        updated_at = now()
    `,
    [
      userId,
      draft.type,
      draft.title,
      draft.body,
      draft.sourceId || null,
      draft.wikiPageId || null,
      draft.relatedSourceId || null,
      draft.relatedWikiPageId || null,
      draft.suggestedQuestion || null,
      JSON.stringify(draft.metadata || {}),
      draft.dedupeKey,
    ],
  );
}
