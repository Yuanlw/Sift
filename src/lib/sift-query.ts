import { query } from "@/lib/db";
import { embedTexts } from "@/lib/models";
import type { ModelCallContext } from "@/lib/model-usage";
import { toSqlVector } from "@/lib/vector";
import type { CaptureType, Json, WikiPageStatus } from "@/types/database";

interface RetrievedChunkRow {
  id: string;
  parent_type: "source" | "wiki_page";
  parent_id: string;
  content: string;
  created_at: string;
  distance: number | null;
  graph_depth: number | null;
  graph_edge_type: string | null;
  graph_path: string[] | null;
  graph_weight: number | null;
  keyword_rank: number | null;
  source_id: string | null;
  source_title: string | null;
  original_url: string | null;
  wiki_slug: string | null;
  wiki_title: string | null;
}

export interface RetrievedContext {
  id: string;
  parentType: "source" | "wiki_page";
  parentId: string;
  title: string;
  content: string;
  sourceId: string | null;
  wikiSlug: string | null;
  originalUrl: string | null;
  vectorScore: number;
  keywordScore: number;
  graphScore: number;
  graphDepth: number;
  graphEdgeType: string | null;
  graphPath: string[];
  vectorRankScore: number;
  keywordRankScore: number;
  titleScore: number;
  rerankScore: number;
  matchReasons: string[];
}

export interface LabeledContext {
  label: string;
  title: string;
  parentType: "source" | "wiki_page";
  content: string;
  sourceId: string | null;
  wikiSlug: string | null;
  originalUrl: string | null;
  matchReasons?: string[];
  graph?: {
    depth: number;
    relationType: string | null;
    path: string[];
  };
}

export interface AgentContext {
  label: string;
  chunkId: string;
  parentType: "source" | "wiki_page";
  parentId: string;
  title: string;
  content: string;
  sourceId: string | null;
  wikiSlug: string | null;
  originalUrl: string | null;
  score: number;
  matchReasons: string[];
  scores: {
    graph: number;
    vector: number;
    keyword: number;
    title: number;
  };
  graph?: {
    depth: number;
    relationType: string | null;
    path: string[];
  };
}

export interface AgentCitation {
  label: string;
  title: string;
  sourceId?: string;
  wikiSlug?: string;
  originalUrl?: string | null;
}

interface SourceDetailRow {
  id: string;
  title: string;
  source_type: CaptureType;
  original_url: string | null;
  extracted_text: string;
  summary: string | null;
  metadata: Json;
  created_at: string;
  capture_id: string;
  capture_note: string | null;
  wiki_id: string | null;
  wiki_title: string | null;
  wiki_slug: string | null;
  relation_type: string | null;
  confidence: number | null;
}

interface WikiDetailRow {
  id: string;
  title: string;
  slug: string;
  content_markdown: string;
  status: WikiPageStatus;
  created_at: string;
  updated_at: string;
  source_id: string | null;
  source_title: string | null;
  source_summary: string | null;
  original_url: string | null;
  relation_type: string | null;
  confidence: number | null;
}

interface AgentResourceRow {
  kind: "source" | "wiki";
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  updated_at: string;
}

interface RetrievalIntent {
  graphBoost: number;
  graphDepth: 1 | 2;
  label: "balanced" | "relation" | "evidence" | "comparison";
  minGraphScore: number;
}

export async function retrieveHybridContexts(
  userId: string,
  searchQuery: string,
  limit = 8,
  modelContext?: Omit<ModelCallContext, "role" | "userId">,
) {
  const intent = inferRetrievalIntent(searchQuery);
  const [vectorRows, keywordRows] = await Promise.all([
    retrieveVectorChunks(userId, searchQuery, modelContext).catch(() => []),
    retrieveKeywordChunks(userId, searchQuery),
  ]);

  const terms = getKeywordTerms(searchQuery);
  const merged = new Map<string, RetrievedContext>();

  for (const [index, row] of vectorRows.entries()) {
    const context = toRetrievedContext(row);
    context.vectorScore = row.distance === null ? 0 : 1 / (1 + Number(row.distance));
    context.vectorRankScore = reciprocalRank(index);
    merged.set(context.id, context);
  }

  for (const [index, row] of keywordRows.entries()) {
    const context = toRetrievedContext(row);
    context.keywordScore = scoreKeywordMatch(context, terms, row.keyword_rank);
    context.keywordRankScore = reciprocalRank(index);
    const existing = merged.get(context.id);

    if (existing) {
      existing.keywordScore = Math.max(existing.keywordScore, context.keywordScore);
      existing.keywordRankScore = Math.max(existing.keywordRankScore, context.keywordRankScore);
    } else {
      merged.set(context.id, context);
    }
  }

  let graphRows: RetrievedChunkRow[] = [];

  try {
    graphRows = await retrieveGraphExpandedChunks(
      userId,
      Array.from(merged.values()),
      Math.max(limit * 3, 10),
      intent,
      searchQuery,
      terms,
    );
  } catch (error) {
    console.error("Knowledge graph expansion failed.", error);
    throw error;
  }

  for (const row of graphRows) {
    if (merged.has(row.id)) {
      continue;
    }

    const context = toRetrievedContext(row);
    context.graphScore = row.graph_weight === null ? 0 : Number(row.graph_weight);
    context.graphDepth = row.graph_depth === null ? 0 : Number(row.graph_depth);
    context.graphEdgeType = row.graph_edge_type;
    context.graphPath = row.graph_path || [];
    merged.set(context.id, context);
  }

  const sorted = rerankContexts(Array.from(merged.values()), terms, intent);
  const hasKeywordHits = sorted.some((context) => context.keywordScore > 0);

  return sorted
    .filter((context, index) => {
      if (context.keywordScore > 0) {
        return true;
      }

      if (context.graphScore > 0) {
        return context.graphScore >= intent.minGraphScore;
      }

      if (!hasKeywordHits) {
        return index < 3 || context.vectorScore > 0.78;
      }

      return context.vectorScore > 0.92;
    })
    .slice(0, limit);
}

export function toLabeledContexts(contexts: RetrievedContext[]): LabeledContext[] {
  return contexts.map((context, index) => ({
    label: `K${index + 1}`,
    title: context.title,
    parentType: context.parentType,
    content: context.content,
    sourceId: context.sourceId,
    wikiSlug: context.wikiSlug,
    originalUrl: context.originalUrl,
    matchReasons: context.matchReasons,
    graph:
      context.graphScore > 0
        ? {
            depth: context.graphDepth,
            relationType: context.graphEdgeType,
            path: context.graphPath,
          }
        : undefined,
  }));
}

export function toAgentContexts(contexts: RetrievedContext[]): AgentContext[] {
  return contexts.map((context, index) => ({
    label: `K${index + 1}`,
    chunkId: context.id,
    parentType: context.parentType,
    parentId: context.parentId,
    title: context.title,
    content: context.content,
    sourceId: context.sourceId,
    wikiSlug: context.wikiSlug,
    originalUrl: context.originalUrl,
    score: scoreContext(context),
    matchReasons: context.matchReasons,
    scores: {
      graph: context.graphScore,
      vector: context.vectorScore,
      keyword: context.keywordScore,
      title: context.titleScore,
    },
    graph:
      context.graphScore > 0
        ? {
            depth: context.graphDepth,
            relationType: context.graphEdgeType,
            path: context.graphPath,
          }
        : undefined,
  }));
}

export function toAgentCitations(contexts: AgentContext[]): AgentCitation[] {
  const seen = new Set<string>();
  const citations: AgentCitation[] = [];

  for (const context of contexts) {
    const key = context.sourceId || context.wikiSlug || context.parentId;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    citations.push({
      label: context.label,
      title: context.title,
      sourceId: context.sourceId || undefined,
      wikiSlug: context.wikiSlug || undefined,
      originalUrl: context.originalUrl,
    });
  }

  return citations;
}

export async function queryAgentContext(input: { userId: string; query: string; limit?: number }) {
  const contexts = await retrieveHybridContexts(input.userId, input.query, input.limit || 8, {
    stage: "agent",
    purpose: "agent.query.embedding",
  });
  const agentContexts = toAgentContexts(contexts);

  return {
    query: input.query,
    contexts: agentContexts,
    citations: toAgentCitations(agentContexts),
  };
}

export async function loadAgentSource(userId: string, sourceId: string) {
  if (!isUuid(sourceId)) {
    return null;
  }

  const result = await query<SourceDetailRow>(
    `
      select
        s.id,
        s.title,
        s.source_type,
        s.original_url,
        s.extracted_text,
        s.summary,
        s.metadata,
        s.created_at,
        s.capture_id,
        c.note as capture_note,
        wp.id as wiki_id,
        wp.title as wiki_title,
        wp.slug as wiki_slug,
        swp.relation_type,
        swp.confidence
      from sources s
      left join captures c on c.id = s.capture_id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where s.id = $1 and s.user_id = $2
      order by wp.updated_at desc
    `,
    [sourceId, userId],
  );

  const first = result.rows[0];

  if (!first) {
    return null;
  }

  return {
    id: first.id,
    title: first.title,
    sourceType: first.source_type,
    originalUrl: first.original_url,
    summary: first.summary,
    extractedText: first.extracted_text,
    metadata: first.metadata,
    createdAt: first.created_at,
    capture: {
      id: first.capture_id,
      note: first.capture_note,
    },
    wikiPages: result.rows
      .filter((row) => row.wiki_id && row.wiki_title && row.wiki_slug)
      .map((row) => ({
        id: row.wiki_id as string,
        title: row.wiki_title as string,
        slug: row.wiki_slug as string,
        relationType: row.relation_type,
        confidence: row.confidence,
      })),
  };
}

export async function loadAgentWikiPage(userId: string, slug: string) {
  const result = await query<WikiDetailRow>(
    `
      select
        wp.id,
        wp.title,
        wp.slug,
        wp.content_markdown,
        wp.status,
        wp.created_at,
        wp.updated_at,
        s.id as source_id,
        s.title as source_title,
        s.summary as source_summary,
        s.original_url,
        swp.relation_type,
        swp.confidence
      from wiki_pages wp
      left join source_wiki_pages swp on swp.wiki_page_id = wp.id
      left join sources s on s.id = swp.source_id
      where wp.slug = $1 and wp.user_id = $2
      order by s.created_at desc
    `,
    [slug, userId],
  );

  const first = result.rows[0];

  if (!first) {
    return null;
  }

  return {
    id: first.id,
    title: first.title,
    slug: first.slug,
    contentMarkdown: first.content_markdown,
    status: first.status,
    createdAt: first.created_at,
    updatedAt: first.updated_at,
    sources: result.rows
      .filter((row) => row.source_id && row.source_title)
      .map((row) => ({
        id: row.source_id as string,
        title: row.source_title as string,
        summary: row.source_summary,
        originalUrl: row.original_url,
        relationType: row.relation_type,
        confidence: row.confidence,
      })),
  };
}

export async function listAgentResources(userId: string, limit = 20) {
  const result = await query<AgentResourceRow>(
    `
      (
        select
          'source'::text as kind,
          s.id,
          s.title,
          null::text as slug,
          s.summary,
          s.created_at as updated_at
        from sources s
        where s.user_id = $1
        order by s.created_at desc
        limit $2
      )
      union all
      (
        select
          'wiki'::text as kind,
          wp.id,
          wp.title,
          wp.slug,
          null::text as summary,
          wp.updated_at
        from wiki_pages wp
        where wp.user_id = $1
        order by wp.updated_at desc
        limit $2
      )
      order by updated_at desc
      limit $2
    `,
    [userId, limit],
  );

  return result.rows.map((row) => ({
    uri: row.kind === "source" ? `sift://source/${row.id}` : `sift://wiki/${encodeURIComponent(row.slug || row.id)}`,
    name: row.kind === "source" ? `source:${row.id.slice(0, 8)}` : `wiki:${row.slug || row.id}`,
    title: row.title,
    description: row.summary || (row.kind === "source" ? "Sift source document" : "Sift WikiPage"),
    mimeType: "application/json",
  }));
}

export async function readAgentResource(userId: string, uri: string) {
  const parsed = parseAgentResourceUri(uri);

  if (!parsed) {
    return null;
  }

  if (parsed.kind === "source") {
    const source = await loadAgentSource(userId, parsed.id);

    if (!source) {
      return null;
    }

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify({ source }, null, 2),
    };
  }

  const wikiPage = await loadAgentWikiPage(userId, parsed.slug);

  if (!wikiPage) {
    return null;
  }

  return {
    uri,
    mimeType: "application/json",
    text: JSON.stringify({ wikiPage }, null, 2),
  };
}

async function retrieveVectorChunks(
  userId: string,
  searchQuery: string,
  modelContext?: Omit<ModelCallContext, "role" | "userId">,
) {
  const [embedding] = await embedTexts([searchQuery], {
    userId,
    role: "embedding",
    stage: modelContext?.stage || "retrieval",
    purpose: modelContext?.purpose || "retrieval.semantic_query",
    resourceType: modelContext?.resourceType,
    resourceId: modelContext?.resourceId,
    metadata: modelContext?.metadata,
  });

  if (!embedding) {
    return [];
  }

  const result = await query<RetrievedChunkRow>(
    `
      select
        c.id,
        c.parent_type,
        c.parent_id,
        c.content,
        c.created_at,
        c.embedding <=> $2::vector as distance,
        null::int as graph_depth,
        null::text as graph_edge_type,
        null::text[] as graph_path,
        null::real as graph_weight,
        null::real as keyword_rank,
        case when c.parent_type = 'source' then s.id else ws.id end as source_id,
        case when c.parent_type = 'source' then s.title else ws.title end as source_title,
        case when c.parent_type = 'source' then s.original_url else ws.original_url end as original_url,
        case when c.parent_type = 'wiki_page' then wp.slug else wps.slug end as wiki_slug,
        case when c.parent_type = 'wiki_page' then wp.title else wps.title end as wiki_title
      from chunks c
      left join sources s on c.parent_type = 'source' and s.id = c.parent_id
      left join source_wiki_pages swps on swps.source_id = s.id
      left join wiki_pages wps on wps.id = swps.wiki_page_id
      left join wiki_pages wp on c.parent_type = 'wiki_page' and wp.id = c.parent_id
      left join source_wiki_pages swpw on swpw.wiki_page_id = wp.id
      left join sources ws on ws.id = swpw.source_id
      where c.user_id = $1 and c.embedding is not null
      order by c.embedding <=> $2::vector
      limit 12
    `,
    [userId, toSqlVector(embedding)],
  );

  return result.rows;
}

async function retrieveKeywordChunks(userId: string, searchQuery: string) {
  const terms = getKeywordTerms(searchQuery);

  if (terms.length === 0) {
    return [];
  }

  const result = await query<RetrievedChunkRow>(
    `
      select
        c.id,
        c.parent_type,
        c.parent_id,
        c.content,
        c.created_at,
        null::real as distance,
        null::int as graph_depth,
        null::text as graph_edge_type,
        null::text[] as graph_path,
        null::real as graph_weight,
        ts_rank_cd(to_tsvector('simple', c.content), websearch_to_tsquery('simple', $2)) as keyword_rank,
        case when c.parent_type = 'source' then s.id else ws.id end as source_id,
        case when c.parent_type = 'source' then s.title else ws.title end as source_title,
        case when c.parent_type = 'source' then s.original_url else ws.original_url end as original_url,
        case when c.parent_type = 'wiki_page' then wp.slug else wps.slug end as wiki_slug,
        case when c.parent_type = 'wiki_page' then wp.title else wps.title end as wiki_title
      from chunks c
      left join sources s on c.parent_type = 'source' and s.id = c.parent_id
      left join source_wiki_pages swps on swps.source_id = s.id
      left join wiki_pages wps on wps.id = swps.wiki_page_id
      left join wiki_pages wp on c.parent_type = 'wiki_page' and wp.id = c.parent_id
      left join source_wiki_pages swpw on swpw.wiki_page_id = wp.id
      left join sources ws on ws.id = swpw.source_id
      where c.user_id = $1
        and (
          c.content ilike any($3::text[])
          or to_tsvector('simple', c.content) @@ websearch_to_tsquery('simple', $2)
        )
      order by keyword_rank desc, c.created_at desc
      limit 24
    `,
    [userId, searchQuery, terms.map((term) => `%${term}%`)],
  );

  return result.rows;
}

async function retrieveGraphExpandedChunks(
  userId: string,
  seeds: RetrievedContext[],
  limit: number,
  intent: RetrievalIntent,
  searchQuery: string,
  terms: string[],
) {
  const seedNodes = uniqueSeedNodes(seeds).slice(0, 8);
  const termPatterns = terms.map((term) => `%${term}%`);

  if (seedNodes.length === 0) {
    return [];
  }

  const result = await query<RetrievedChunkRow>(
    `
      with seed_nodes as (
        select *
        from unnest($2::text[], $3::uuid[]) as seeds(parent_type, parent_id)
      ),
      edge_weights(edge_type, multiplier) as (
        values
          ('source_wiki'::text, 1.0::real),
          ('related_wiki'::text, 0.88::real),
          ('duplicate_source'::text, 0.45::real),
          ('supports'::text, 0.95::real),
          ('contradicts'::text, 0.75::real)
      ),
      one_hop_nodes as (
        select
          e.to_type as parent_type,
          e.to_id as parent_id,
          e.edge_type,
          1 as graph_depth,
          array[e.edge_type]::text[] as graph_path,
          e.weight * coalesce(e.confidence, 1) * coalesce(ew.multiplier, 0.6) as graph_weight
        from knowledge_edges e
        left join edge_weights ew on ew.edge_type = e.edge_type
        join seed_nodes sn on sn.parent_type = e.from_type and sn.parent_id = e.from_id
        where e.user_id = $1
        union all
        select
          e.from_type as parent_type,
          e.from_id as parent_id,
          e.edge_type,
          1 as graph_depth,
          array[e.edge_type]::text[] as graph_path,
          e.weight * coalesce(e.confidence, 1) * coalesce(ew.multiplier, 0.6) as graph_weight
        from knowledge_edges e
        left join edge_weights ew on ew.edge_type = e.edge_type
        join seed_nodes sn on sn.parent_type = e.to_type and sn.parent_id = e.to_id
        where e.user_id = $1
      ),
      two_hop_nodes as (
        select
          e.to_type as parent_type,
          e.to_id as parent_id,
          e.edge_type,
          2 as graph_depth,
          oh.graph_path || e.edge_type as graph_path,
          oh.graph_weight * e.weight * coalesce(e.confidence, 1) * coalesce(ew.multiplier, 0.6) * 0.55 as graph_weight
        from one_hop_nodes oh
        join knowledge_edges e on e.user_id = $1
          and e.from_type = oh.parent_type
          and e.from_id = oh.parent_id
        left join edge_weights ew on ew.edge_type = e.edge_type
        where $5::boolean
        union all
        select
          e.from_type as parent_type,
          e.from_id as parent_id,
          e.edge_type,
          2 as graph_depth,
          oh.graph_path || e.edge_type as graph_path,
          oh.graph_weight * e.weight * coalesce(e.confidence, 1) * coalesce(ew.multiplier, 0.6) * 0.55 as graph_weight
        from one_hop_nodes oh
        join knowledge_edges e on e.user_id = $1
          and e.to_type = oh.parent_type
          and e.to_id = oh.parent_id
        left join edge_weights ew on ew.edge_type = e.edge_type
        where $5::boolean
      ),
      related_nodes as (
        select * from one_hop_nodes
        union all
        select * from two_hop_nodes
      ),
      ranked_nodes as (
        select distinct on (parent_type, parent_id)
          parent_type,
          parent_id,
          edge_type,
          graph_depth,
          graph_path,
          graph_weight
        from related_nodes
        where graph_weight >= $6::real
          and not exists (
            select 1
            from seed_nodes sn
            where sn.parent_type = related_nodes.parent_type and sn.parent_id = related_nodes.parent_id
          )
        order by parent_type, parent_id, graph_weight desc, graph_depth asc
      ),
      ranked_chunks as (
        select *,
          row_number() over (
            partition by parent_type, parent_id
            order by title_relevance desc, keyword_rank desc, term_hit desc, graph_weight desc, created_at desc
          ) as chunk_rank
        from (
          select
            c.id,
            c.parent_type,
            c.parent_id,
            c.content,
            c.created_at,
            null::real as distance,
            rn.graph_depth,
            rn.edge_type as graph_edge_type,
            rn.graph_path,
            rn.graph_weight::real as graph_weight,
            ts_rank_cd(to_tsvector('simple', c.content), websearch_to_tsquery('simple', $7))::real as keyword_rank,
            case when c.content ilike any($8::text[]) then 1 else 0 end as term_hit,
            case
              when c.parent_type = 'source' and (
                s.title ilike any($8::text[])
                or coalesce(s.summary, '') ilike any($8::text[])
              ) then 1
              when c.parent_type = 'wiki_page' and wp.title ilike any($8::text[]) then 1
              else 0
            end as title_relevance,
            case when c.parent_type = 'source' then s.id else ws.id end as source_id,
            case when c.parent_type = 'source' then s.title else ws.title end as source_title,
            case when c.parent_type = 'source' then s.original_url else ws.original_url end as original_url,
            case when c.parent_type = 'wiki_page' then wp.slug else wps.slug end as wiki_slug,
            case when c.parent_type = 'wiki_page' then wp.title else wps.title end as wiki_title
          from ranked_nodes rn
          join chunks c on c.user_id = $1 and c.parent_type = rn.parent_type and c.parent_id = rn.parent_id
          left join sources s on c.parent_type = 'source' and s.id = c.parent_id
          left join source_wiki_pages swps on swps.source_id = s.id
          left join wiki_pages wps on wps.id = swps.wiki_page_id
          left join wiki_pages wp on c.parent_type = 'wiki_page' and wp.id = c.parent_id
          left join source_wiki_pages swpw on swpw.wiki_page_id = wp.id
          left join sources ws on ws.id = swpw.source_id
        ) scored_chunks
      )
      select
        id,
        parent_type,
        parent_id,
        content,
        created_at,
        distance,
        graph_depth,
        graph_edge_type,
        graph_path,
        graph_weight,
        keyword_rank,
        source_id,
        source_title,
        original_url,
        wiki_slug,
        wiki_title
      from ranked_chunks
      where chunk_rank <= 2
      order by graph_weight desc, created_at desc
      limit $4
    `,
    [
      userId,
      seedNodes.map((node) => node.parentType),
      seedNodes.map((node) => node.parentId),
      limit,
      intent.graphDepth > 1,
      intent.minGraphScore,
      searchQuery,
      termPatterns,
    ],
  );

  return result.rows;
}

function toRetrievedContext(row: RetrievedChunkRow): RetrievedContext {
  return {
    id: row.id,
    parentType: row.parent_type,
    parentId: row.parent_id,
    title: row.parent_type === "source" ? row.source_title || "未命名来源" : row.wiki_title || "未命名知识页",
    content: row.content,
    sourceId: row.source_id,
    wikiSlug: row.wiki_slug,
    originalUrl: row.original_url,
    vectorScore: 0,
    keywordScore: 0,
    graphScore: 0,
    graphDepth: 0,
    graphEdgeType: null,
    graphPath: [],
    vectorRankScore: 0,
    keywordRankScore: 0,
    titleScore: 0,
    rerankScore: 0,
    matchReasons: [],
  };
}

function scoreContext(context: RetrievedContext) {
  return context.rerankScore || context.vectorScore * 0.35 + context.keywordScore * 0.65;
}

function rerankContexts(contexts: RetrievedContext[], terms: string[], intent: RetrievalIntent) {
  const selectedCountByParent = new Map<string, number>();

  for (const context of contexts) {
    context.titleScore = scoreTitleMatch(context.title, terms);
    context.rerankScore =
      context.vectorRankScore * 1.8 +
      context.keywordRankScore * 2.2 +
      context.vectorScore * 0.45 +
      context.keywordScore * 1.3 +
      context.graphScore * getGraphBoost(context, intent) +
      context.titleScore * 0.35;
    context.matchReasons = buildMatchReasons(context);
  }

  const sorted = [...contexts].sort((left, right) => right.rerankScore - left.rerankScore);
  const reranked: RetrievedContext[] = [];

  while (sorted.length > 0 && reranked.length < 12) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const [index, context] of sorted.entries()) {
      const parentKey = citationKey(context);
      const duplicatePenalty = (selectedCountByParent.get(parentKey) || 0) * 0.22;
      const adjustedScore = context.rerankScore - duplicatePenalty;

      if (adjustedScore > bestScore) {
        bestIndex = index;
        bestScore = adjustedScore;
      }
    }

    const [next] = sorted.splice(bestIndex, 1);
    selectedCountByParent.set(citationKey(next), (selectedCountByParent.get(citationKey(next)) || 0) + 1);
    reranked.push(next);
  }

  return reranked;
}

function reciprocalRank(index: number) {
  return 1 / (60 + index + 1);
}

function citationKey(context: RetrievedContext) {
  return context.sourceId || context.wikiSlug || context.parentId;
}

function buildMatchReasons(context: RetrievedContext) {
  const reasons: string[] = [];

  if (context.keywordScore > 0) {
    reasons.push("关键词命中");
  }

  if (context.vectorScore > 0) {
    reasons.push("语义相似");
  }

  if (context.titleScore > 0) {
    reasons.push("标题相关");
  }

  if (context.graphScore > 0) {
    reasons.push(getGraphReason(context));
  }

  return reasons.length > 0 ? reasons : ["最近片段"];
}

function inferRetrievalIntent(searchQuery: string): RetrievalIntent {
  const normalized = searchQuery.toLowerCase();

  if (/(对比|比较|差异|区别|相同|不同|compare|versus|vs\.?)/i.test(normalized)) {
    return {
      graphBoost: 1.35,
      graphDepth: 2,
      label: "comparison",
      minGraphScore: 0.14,
    };
  }

  if (/(来源|出处|证据|引用|支撑|依据|支持|反驳|冲突|source|citation|evidence|support|contradict)/i.test(normalized)) {
    return {
      graphBoost: 1.3,
      graphDepth: 2,
      label: "evidence",
      minGraphScore: 0.15,
    };
  }

  if (/(关联|关系|相关|相似|类似|延伸|联系|重复|同类|related|similar|connection|duplicate)/i.test(normalized)) {
    return {
      graphBoost: 1.45,
      graphDepth: 2,
      label: "relation",
      minGraphScore: 0.13,
    };
  }

  return {
    graphBoost: 1,
    graphDepth: 1,
    label: "balanced",
    minGraphScore: 0.2,
  };
}

function getGraphBoost(context: RetrievedContext, intent: RetrievalIntent) {
  const depthPenalty = context.graphDepth >= 2 ? 0.72 : 1;
  const relationBoost = getRelationBoost(context.graphEdgeType);
  return 1.1 * intent.graphBoost * depthPenalty * relationBoost;
}

function getRelationBoost(edgeType: string | null) {
  if (edgeType === "source_wiki") {
    return 1.05;
  }

  if (edgeType === "related_wiki") {
    return 0.95;
  }

  if (edgeType === "duplicate_source") {
    return 0.58;
  }

  if (edgeType === "supports") {
    return 1.08;
  }

  if (edgeType === "contradicts") {
    return 0.82;
  }

  return 0.75;
}

function getGraphReason(context: RetrievedContext) {
  const relationLabels: Record<string, string> = {
    contradicts: "冲突关系",
    duplicate_source: "重复来源",
    related_wiki: "相关知识页",
    source_wiki: "来源归属",
    supports: "证据支撑",
  };
  const relation = context.graphEdgeType ? relationLabels[context.graphEdgeType] || context.graphEdgeType : "关系扩展";
  const depth = context.graphDepth > 1 ? `${context.graphDepth}跳` : "1跳";

  return `${depth}${relation}`;
}

function uniqueSeedNodes(contexts: RetrievedContext[]) {
  const seen = new Set<string>();
  const nodes: Array<{ parentId: string; parentType: "source" | "wiki_page" }> = [];

  for (const context of contexts) {
    const key = `${context.parentType}:${context.parentId}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nodes.push({
      parentId: context.parentId,
      parentType: context.parentType,
    });
  }

  return nodes;
}

function scoreKeywordMatch(context: RetrievedContext, terms: string[], sqlRank: number | null) {
  if (terms.length === 0) {
    return 0;
  }

  const normalizedContent = context.content.toLowerCase();
  const normalizedTitle = context.title.toLowerCase();
  const matched = terms.filter((term) => {
    const normalizedTerm = term.toLowerCase();
    return normalizedContent.includes(normalizedTerm) || normalizedTitle.includes(normalizedTerm);
  }).length;
  const lexicalScore = matched / terms.length;
  const rankScore = sqlRank ? Math.min(Number(sqlRank), 1) : 0;
  return lexicalScore * 0.75 + rankScore * 0.25;
}

function scoreTitleMatch(title: string, terms: string[]) {
  if (terms.length === 0) {
    return 0;
  }

  const normalized = title.toLowerCase();
  const matched = terms.filter((term) => normalized.includes(term.toLowerCase())).length;
  return matched / terms.length;
}

function getKeywordTerms(question: string) {
  const stopwords = new Set([
    "这个",
    "这些",
    "这份",
    "资料",
    "内容",
    "什么",
    "哪些",
    "怎么",
    "如何",
    "可以",
    "是否",
    "有没有",
    "的是",
    "有什么",
    "值得",
    "复用",
    "结论",
    "用的",
  ]);
  const normalized = question
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
  const words = normalized
    .split(/\s+/)
    .filter((term) => /[a-z0-9]/i.test(term) && term.length >= 2 && !stopwords.has(term));
  const cjk = Array.from(question.matchAll(/[\u3400-\u9fff]{2,}/g))
    .flatMap((match) => toBigrams(match[0]))
    .filter((term) => !stopwords.has(term))
    .slice(0, 12);

  return Array.from(new Set([...words, ...cjk])).slice(0, 20);
}

function toBigrams(value: string) {
  const chars = Array.from(value);
  const bigrams: string[] = [];

  for (let index = 0; index < chars.length - 1; index += 1) {
    bigrams.push(`${chars[index]}${chars[index + 1]}`);
  }

  return bigrams;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseAgentResourceUri(uri: string) {
  let parsed: URL;

  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }

  if (parsed.protocol !== "sift:") {
    return null;
  }

  if (parsed.hostname === "source") {
    const id = parsed.pathname.replace(/^\/+/, "");
    return isUuid(id) ? { kind: "source" as const, id } : null;
  }

  if (parsed.hostname === "wiki") {
    const slug = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return slug ? { kind: "wiki" as const, slug } : null;
  }

  return null;
}
