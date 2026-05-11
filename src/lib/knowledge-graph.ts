import { query } from "@/lib/db";
import type { Json, KnowledgeEdgeNodeType, KnowledgeEdgeType } from "@/types/database";

interface KnowledgeGraphRow {
  related_type: KnowledgeEdgeNodeType;
  related_id: string;
  edge_type: KnowledgeEdgeType;
  weight: number;
  confidence: number | null;
  evidence: Json;
  direction: "in" | "out";
  title: string | null;
  slug: string | null;
  summary: string | null;
  original_url: string | null;
  updated_at: string | null;
}

export interface KnowledgeGraphNeighbor {
  confidence: number | null;
  direction: "in" | "out";
  edgeType: KnowledgeEdgeType;
  evidence: Json;
  href: string;
  id: string;
  originalUrl: string | null;
  score: number;
  summary: string | null;
  title: string;
  type: KnowledgeEdgeNodeType;
  updatedAt: string | null;
  weight: number;
}

export async function loadKnowledgeGraphNeighborhood(input: {
  limit?: number;
  nodeId: string;
  nodeType: KnowledgeEdgeNodeType;
  userId: string;
}) {
  const result = await query<KnowledgeGraphRow>(
    `
      with edge_rows as (
        select
          case
            when e.from_type = $2 and e.from_id = $3 then e.to_type
            else e.from_type
          end as related_type,
          case
            when e.from_type = $2 and e.from_id = $3 then e.to_id
            else e.from_id
          end as related_id,
          e.edge_type,
          e.weight,
          e.confidence,
          e.evidence,
          case
            when e.from_type = $2 and e.from_id = $3 then 'out'
            else 'in'
          end as direction,
          e.updated_at,
          e.weight * coalesce(e.confidence, 1) as score
        from knowledge_edges e
        where e.user_id = $1
          and e.edge_type <> 'source_wiki'
          and e.weight > 0
          and (e.evidence->>'inactive_reason') is null
          and (
            (e.from_type = $2 and e.from_id = $3)
            or (e.to_type = $2 and e.to_id = $3)
          )
      ),
      ranked_edges as (
        select distinct on (related_type, related_id)
          *
        from edge_rows
        order by related_type, related_id, score desc, updated_at desc
      )
      select
        re.related_type,
        re.related_id,
        re.edge_type,
        re.weight,
        re.confidence,
        re.evidence,
        re.direction,
        case when re.related_type = 'source' then s.title else wp.title end as title,
        wp.slug,
        case when re.related_type = 'source' then s.summary else left(wp.content_markdown, 220) end as summary,
        s.original_url,
        case when re.related_type = 'source' then s.created_at else wp.updated_at end::text as updated_at
      from ranked_edges re
      left join sources s on re.related_type = 'source'
        and s.id = re.related_id
        and s.user_id = $1
      left join captures c on c.id = s.capture_id
      left join wiki_pages wp on re.related_type = 'wiki_page'
        and wp.id = re.related_id
        and wp.user_id = $1
      where (re.related_type = 'source' and s.id is not null and (c.status is null or c.status <> 'ignored'))
         or (re.related_type = 'wiki_page' and wp.id is not null and wp.status <> 'archived')
      order by (re.weight * coalesce(re.confidence, 1)) desc, re.updated_at desc
      limit $4
    `,
    [input.userId, input.nodeType, input.nodeId, input.limit || 8],
  );

  return result.rows.map(toNeighbor);
}

function toNeighbor(row: KnowledgeGraphRow): KnowledgeGraphNeighbor {
  const score = row.weight * (row.confidence ?? 1);

  return {
    confidence: row.confidence,
    direction: row.direction,
    edgeType: row.edge_type,
    evidence: row.evidence,
    href: row.related_type === "source" ? `/sources/${row.related_id}` : `/wiki/${encodeURIComponent(row.slug || row.related_id)}`,
    id: row.related_id,
    originalUrl: row.original_url,
    score,
    summary: row.summary,
    title: row.title || (row.related_type === "source" ? "未命名来源" : "未命名知识页"),
    type: row.related_type,
    updatedAt: row.updated_at,
    weight: row.weight,
  };
}
