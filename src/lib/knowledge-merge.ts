import type { PoolClient } from "pg";
import { chunkText, roughTokenCount } from "@/lib/chunk";
import { query, transaction } from "@/lib/db";
import { evaluateMergeEligibility } from "@/lib/knowledge-discoveries";
import { embedTexts, generateMergedWikiPage, type MergedWikiDraft } from "@/lib/models";
import { toSqlVector } from "@/lib/vector";
import type { Json, KnowledgeDiscoveryType } from "@/types/database";

interface MergeDiscoveryRow {
  id: string;
  discovery_type: KnowledgeDiscoveryType;
  metadata: Json;
  source_id: string | null;
  source_title: string | null;
  source_summary: string | null;
  source_original_url: string | null;
  source_extracted_text: string | null;
  wiki_page_id: string | null;
  wiki_title: string | null;
  wiki_slug: string | null;
  wiki_content_markdown: string | null;
  related_source_id: string | null;
  related_source_title: string | null;
  related_wiki_page_id: string | null;
  related_wiki_title: string | null;
  related_wiki_slug: string | null;
  related_wiki_content_markdown: string | null;
  related_source_wiki_page_id: string | null;
  related_source_wiki_title: string | null;
  related_source_wiki_slug: string | null;
  related_source_wiki_content_markdown: string | null;
}

interface MergeSource {
  id: string;
  title: string;
  summary: string | null;
  originalUrl: string | null;
  extractedText: string;
}

export interface WikiMergeCandidate {
  discoveryId: string;
  discoveryType: "duplicate_source" | "related_wiki";
  incomingWiki: {
    id: string;
    title: string;
    slug: string;
    markdown: string;
  };
  sources: MergeSource[];
  targetWiki: {
    id: string;
    title: string;
    slug: string;
    markdown: string;
  };
}

export interface WikiMergePreview extends MergedWikiDraft {
  candidate: WikiMergeCandidate;
}

export async function createWikiMergePreview(input: {
  discoveryId: string;
  userId: string;
}): Promise<WikiMergePreview> {
  const candidate = await loadWikiMergeCandidate(input);
  const draft = await generateMergedWikiPage({
    modelContext: {
      userId: input.userId,
      stage: "management",
      role: "text",
      purpose: "wiki.merge.preview",
      resourceType: "knowledge_discovery",
      resourceId: input.discoveryId,
    },
    targetWiki: {
      title: candidate.targetWiki.title,
      markdown: candidate.targetWiki.markdown,
    },
    incomingWiki: {
      title: candidate.incomingWiki.title,
      markdown: candidate.incomingWiki.markdown,
    },
    sources: candidate.sources.map((source, index) => ({
      label: `S${index + 1}`,
      title: source.title,
      summary: source.summary,
      originalUrl: source.originalUrl,
      extractedText: source.extractedText,
    })),
  }).catch(() => createFallbackMergeDraft(candidate));

  return {
    ...draft,
    candidate,
  };
}

export async function commitWikiMerge(input: {
  discoveryId: string;
  summaryOfChanges?: string | null;
  title: string;
  userId: string;
  wikiMarkdown: string;
}) {
  const candidate = await loadWikiMergeCandidate({
    discoveryId: input.discoveryId,
    userId: input.userId,
  });
  const title = normalizeTitle(input.title, candidate.targetWiki.title);
  const wikiMarkdown = normalizeMarkdown(input.wikiMarkdown, candidate.targetWiki.markdown);
  const embeddings = await embedTexts(chunkText(wikiMarkdown), {
    userId: input.userId,
    stage: "management",
    role: "embedding",
    purpose: "wiki.merge.embedding",
    resourceType: "wiki_page",
    resourceId: candidate.targetWiki.id,
    metadata: {
      discovery_id: input.discoveryId,
      source_count: candidate.sources.length,
    },
  }).catch(() => []);

  await transaction(async (client) => {
    await insertMergeHistory(client, input.userId, candidate, {
      title,
      wikiMarkdown,
      summaryOfChanges: input.summaryOfChanges || null,
    });
    await client.query(
      `
        update wiki_pages
        set title = $3,
            content_markdown = $4,
            updated_at = now()
        where id = $1 and user_id = $2
      `,
      [candidate.targetWiki.id, input.userId, title, wikiMarkdown],
    );

    if (candidate.incomingWiki.id !== candidate.targetWiki.id) {
      await client.query(
        `
          update wiki_pages
          set status = 'archived',
              updated_at = now()
          where id = $1 and user_id = $2
        `,
        [candidate.incomingWiki.id, input.userId],
      );
    }

    for (const source of candidate.sources) {
      await client.query(
        `
          insert into source_wiki_pages (source_id, wiki_page_id, relation_type, confidence)
          values ($1, $2, 'merged_into_wiki', 0.95)
          on conflict (source_id, wiki_page_id)
          do update set
            relation_type = 'merged_into_wiki',
            confidence = greatest(coalesce(source_wiki_pages.confidence, 0), 0.95)
        `,
        [source.id, candidate.targetWiki.id],
      );
      await upsertSourceWikiEdge(client, input.userId, source.id, candidate.targetWiki.id, input.discoveryId);
    }

    if (candidate.incomingWiki.id !== candidate.targetWiki.id) {
      await upsertRelatedWikiEdge(client, input.userId, candidate.incomingWiki.id, candidate.targetWiki.id, input.discoveryId);
    }

    await rebuildWikiChunks(client, input.userId, candidate.targetWiki.id, wikiMarkdown, embeddings);
    await client.query(
      `
        update knowledge_discoveries
        set status = 'ignored',
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object(
                'merged_at', now(),
                'merged_into_wiki_page_id', $3::text,
                'merge_summary', $4::text
              ),
            updated_at = now()
        where id = $1 and user_id = $2
      `,
      [input.discoveryId, input.userId, candidate.targetWiki.id, input.summaryOfChanges || "Merged into wiki page."],
    );
  });

  return {
    slug: candidate.targetWiki.slug,
    targetWikiId: candidate.targetWiki.id,
    title,
  };
}

async function loadWikiMergeCandidate(input: {
  discoveryId: string;
  userId: string;
}): Promise<WikiMergeCandidate> {
  const result = await query<MergeDiscoveryRow>(
    `
      select
        kd.id,
        kd.discovery_type,
        kd.metadata,
        s.id as source_id,
        s.title as source_title,
        s.summary as source_summary,
        s.original_url as source_original_url,
        s.extracted_text as source_extracted_text,
        wp.id as wiki_page_id,
        wp.title as wiki_title,
        wp.slug as wiki_slug,
        wp.content_markdown as wiki_content_markdown,
        rs.id as related_source_id,
        rs.title as related_source_title,
        rwp.id as related_wiki_page_id,
        rwp.title as related_wiki_title,
        rwp.slug as related_wiki_slug,
        rwp.content_markdown as related_wiki_content_markdown,
        rswp.id as related_source_wiki_page_id,
        rswp.title as related_source_wiki_title,
        rswp.slug as related_source_wiki_slug,
        rswp.content_markdown as related_source_wiki_content_markdown
      from knowledge_discoveries kd
      left join sources s on s.id = kd.source_id and s.user_id = kd.user_id
      left join wiki_pages wp on wp.id = kd.wiki_page_id and wp.user_id = kd.user_id
      left join sources rs on rs.id = kd.related_source_id and rs.user_id = kd.user_id
      left join source_wiki_pages rsswp on rsswp.source_id = rs.id
      left join wiki_pages rswp on rswp.id = rsswp.wiki_page_id and rswp.user_id = kd.user_id
      left join wiki_pages rwp on rwp.id = kd.related_wiki_page_id and rwp.user_id = kd.user_id
      where kd.id = $1
        and kd.user_id = $2
        and kd.status <> 'ignored'
        and kd.discovery_type in ('related_wiki', 'duplicate_source')
      order by rsswp.created_at desc nulls last
      limit 1
    `,
    [input.discoveryId, input.userId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("Merge discovery not found.");
  }

  const incomingWiki = getIncomingWiki(row);
  const targetWiki = getTargetWiki(row);
  const sources = getMergeSources(row);

  if (!incomingWiki || !targetWiki || sources.length === 0) {
    throw new Error("This discovery does not have enough source and wiki context to merge.");
  }

  if (incomingWiki.id === targetWiki.id) {
    throw new Error("Incoming wiki and target wiki are the same page.");
  }

  const mergeEligibility = evaluateMergeEligibility(row.discovery_type, row.metadata);

  if (!mergeEligibility.canMerge) {
    throw new Error(`This discovery is only weakly related and should not be merged automatically: ${mergeEligibility.reason}.`);
  }

  return {
    discoveryId: row.id,
    discoveryType: row.discovery_type as "duplicate_source" | "related_wiki",
    incomingWiki,
    sources,
    targetWiki,
  };
}

function getIncomingWiki(row: MergeDiscoveryRow): WikiMergeCandidate["incomingWiki"] | null {
  if (!row.wiki_page_id || !row.wiki_title || !row.wiki_slug || !row.wiki_content_markdown) {
    return null;
  }

  return {
    id: row.wiki_page_id,
    title: row.wiki_title,
    slug: row.wiki_slug,
    markdown: row.wiki_content_markdown,
  };
}

function getTargetWiki(row: MergeDiscoveryRow): WikiMergeCandidate["targetWiki"] | null {
  if (row.related_wiki_page_id && row.related_wiki_title && row.related_wiki_slug && row.related_wiki_content_markdown) {
    return {
      id: row.related_wiki_page_id,
      title: row.related_wiki_title,
      slug: row.related_wiki_slug,
      markdown: row.related_wiki_content_markdown,
    };
  }

  if (
    row.related_source_wiki_page_id &&
    row.related_source_wiki_title &&
    row.related_source_wiki_slug &&
    row.related_source_wiki_content_markdown
  ) {
    return {
      id: row.related_source_wiki_page_id,
      title: row.related_source_wiki_title,
      slug: row.related_source_wiki_slug,
      markdown: row.related_source_wiki_content_markdown,
    };
  }

  return null;
}

function getMergeSources(row: MergeDiscoveryRow): MergeSource[] {
  const sources: MergeSource[] = [];

  if (row.source_id && row.source_title && row.source_extracted_text) {
    sources.push({
      id: row.source_id,
      title: row.source_title,
      summary: row.source_summary,
      originalUrl: row.source_original_url,
      extractedText: row.source_extracted_text,
    });
  }

  return sources;
}

function createFallbackMergeDraft(candidate: WikiMergeCandidate): MergedWikiDraft {
  const sourceSection = candidate.sources
    .map((source, index) =>
      [
        `### [S${index + 1}] ${source.title}`,
        source.originalUrl ? `原始链接：${source.originalUrl}` : "",
        source.summary ? `摘要：${source.summary}` : "",
        "",
        source.extractedText.slice(0, 2400),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  return {
    title: candidate.targetWiki.title,
    summaryOfChanges: "模型合并暂时不可用，已生成可确认的保守追加版本。",
    wikiMarkdown: [
      candidate.targetWiki.markdown.trim(),
      "",
      "## 待融合资料",
      `来自「${candidate.incomingWiki.title}」的内容需要人工确认后继续整理。`,
      "",
      sourceSection,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function insertMergeHistory(
  client: PoolClient,
  userId: string,
  candidate: WikiMergeCandidate,
  after: {
    title: string;
    wikiMarkdown: string;
    summaryOfChanges: string | null;
  },
) {
  await client.query(
    `
      insert into wiki_merge_histories (
        user_id,
        target_wiki_page_id,
        merged_wiki_page_id,
        discovery_id,
        before_title,
        before_content_markdown,
        after_title,
        after_content_markdown,
        merged_source_ids,
        summary,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb)
    `,
    [
      userId,
      candidate.targetWiki.id,
      candidate.incomingWiki.id,
      candidate.discoveryId,
      candidate.targetWiki.title,
      candidate.targetWiki.markdown,
      after.title,
      after.wikiMarkdown,
      JSON.stringify(candidate.sources.map((source) => source.id)),
      after.summaryOfChanges,
      JSON.stringify({
        discovery_type: candidate.discoveryType,
        incoming_slug: candidate.incomingWiki.slug,
        target_slug: candidate.targetWiki.slug,
      }),
    ],
  );
}

async function upsertSourceWikiEdge(
  client: PoolClient,
  userId: string,
  sourceId: string,
  wikiPageId: string,
  discoveryId: string,
) {
  await client.query(
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
      values ($1, 'source', $2, 'wiki_page', $3, 'source_wiki', 1, 0.96, $4::jsonb, $5)
      on conflict (user_id, dedupe_key)
      do update set
        weight = greatest(knowledge_edges.weight, excluded.weight),
        confidence = greatest(coalesce(knowledge_edges.confidence, 0), coalesce(excluded.confidence, 0)),
        evidence = excluded.evidence,
        updated_at = now()
    `,
    [
      userId,
      sourceId,
      wikiPageId,
      JSON.stringify({
        reason: "wiki_merge",
        discovery_id: discoveryId,
      }),
      `source:${sourceId}:wiki:${wikiPageId}`,
    ],
  );
}

async function upsertRelatedWikiEdge(
  client: PoolClient,
  userId: string,
  incomingWikiPageId: string,
  targetWikiPageId: string,
  discoveryId: string,
) {
  await client.query(
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
      values ($1, 'wiki_page', $2, 'wiki_page', $3, 'related_wiki', 0.92, 0.9, $4::jsonb, $5)
      on conflict (user_id, dedupe_key)
      do update set
        weight = greatest(knowledge_edges.weight, excluded.weight),
        confidence = greatest(coalesce(knowledge_edges.confidence, 0), coalesce(excluded.confidence, 0)),
        evidence = excluded.evidence,
        updated_at = now()
    `,
    [
      userId,
      incomingWikiPageId,
      targetWikiPageId,
      JSON.stringify({
        reason: "wiki_merge",
        discovery_id: discoveryId,
      }),
      `wiki:${incomingWikiPageId}:merged-related:${targetWikiPageId}`,
    ],
  );
}

async function rebuildWikiChunks(
  client: PoolClient,
  userId: string,
  wikiPageId: string,
  wikiMarkdown: string,
  embeddings: number[][],
) {
  const chunks = chunkText(wikiMarkdown);

  await client.query(
    `
      delete from chunks
      where user_id = $1
        and parent_type = 'wiki_page'
        and parent_id = $2
    `,
    [userId, wikiPageId],
  );

  for (const [index, content] of chunks.entries()) {
    await client.query(
      `
        insert into chunks (user_id, parent_type, parent_id, content, embedding, token_count)
        values ($1, 'wiki_page', $2, $3, $4::vector, $5)
      `,
      [
        userId,
        wikiPageId,
        content,
        embeddings[index] ? toSqlVector(embeddings[index]) : null,
        roughTokenCount(content),
      ],
    );
  }
}

function normalizeTitle(value: string, fallback: string) {
  return value.trim().slice(0, 180) || fallback;
}

function normalizeMarkdown(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized.length >= 20 ? normalized.slice(0, 120000) : fallback;
}
