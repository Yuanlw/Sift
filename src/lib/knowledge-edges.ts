import { query } from "@/lib/db";
import {
  loadDuplicateSourceSuggestions,
  loadSimilarWikiPageSuggestions,
} from "@/lib/reuse-suggestions";
import type { Json, Source, WikiPage } from "@/types/database";

export type KnowledgeEdgeNodeType = "source" | "wiki_page";
export type KnowledgeEdgeType = "duplicate_source" | "related_wiki" | "source_wiki";

interface KnowledgeEdgeDraft {
  confidence: number;
  dedupeKey: string;
  edgeType: KnowledgeEdgeType;
  evidence: Json;
  fromId: string;
  fromType: KnowledgeEdgeNodeType;
  toId: string;
  toType: KnowledgeEdgeNodeType;
  weight: number;
}

export async function createKnowledgeEdgesForProcessedCapture(input: {
  source: Source;
  userId: string;
  wikiPage: WikiPage;
}) {
  const drafts: KnowledgeEdgeDraft[] = [
    {
      confidence: 0.95,
      dedupeKey: `source:${input.source.id}:wiki:${input.wikiPage.id}`,
      edgeType: "source_wiki",
      evidence: {
        reason: "processing_link",
      },
      fromId: input.source.id,
      fromType: "source",
      toId: input.wikiPage.id,
      toType: "wiki_page",
      weight: 1,
    },
  ];

  const [duplicateSources, similarWikiPages] = await Promise.all([
    loadDuplicateSourceSuggestions({
      userId: input.userId,
      sourceId: input.source.id,
      limit: 3,
    }).catch(() => []),
    loadSimilarWikiPageSuggestions({
      userId: input.userId,
      wikiPageId: input.wikiPage.id,
      limit: 5,
    }).catch(() => []),
  ]);

  for (const suggestion of duplicateSources) {
    drafts.push({
      confidence: suggestion.score,
      dedupeKey: `source:${input.source.id}:duplicate:${suggestion.sourceId}`,
      edgeType: "duplicate_source",
      evidence: {
        reasons: suggestion.reasons,
        related_title: suggestion.title,
      },
      fromId: input.source.id,
      fromType: "source",
      toId: suggestion.sourceId,
      toType: "source",
      weight: 0.86,
    });
  }

  for (const suggestion of similarWikiPages) {
    drafts.push({
      confidence: suggestion.score,
      dedupeKey: `wiki:${input.wikiPage.id}:related:${suggestion.wikiPageId}`,
      edgeType: "related_wiki",
      evidence: {
        reasons: suggestion.reasons,
        related_slug: suggestion.slug,
        related_title: suggestion.title,
      },
      fromId: input.wikiPage.id,
      fromType: "wiki_page",
      toId: suggestion.wikiPageId,
      toType: "wiki_page",
      weight: 0.72,
    });
  }

  for (const draft of drafts) {
    await upsertKnowledgeEdge(input.userId, draft);
  }
}

async function upsertKnowledgeEdge(userId: string, draft: KnowledgeEdgeDraft) {
  await query(
    `
      insert into knowledge_edges (
        user_id,
        from_type,
        from_id,
        to_type,
        to_id,
        edge_type,
        weight,
        confidence,
        evidence,
        dedupe_key
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      on conflict (user_id, dedupe_key)
      do update set
        edge_type = excluded.edge_type,
        weight = greatest(knowledge_edges.weight, excluded.weight),
        confidence = greatest(coalesce(knowledge_edges.confidence, 0), coalesce(excluded.confidence, 0)),
        evidence = excluded.evidence,
        updated_at = now()
    `,
    [
      userId,
      draft.fromType,
      draft.fromId,
      draft.toType,
      draft.toId,
      draft.edgeType,
      draft.weight,
      draft.confidence,
      JSON.stringify(draft.evidence),
      draft.dedupeKey,
    ],
  );
}
