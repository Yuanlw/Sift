import { query } from "@/lib/db";
import type { Json, KnowledgeRecommendation, Source } from "@/types/database";

interface SourceCandidate {
  id: string;
  title: string;
  summary: string | null;
  extracted_text: string;
  note: string | null;
  created_at: string;
}

interface RecommendationDraft {
  sourceId: string;
  triggerSourceId: string | null;
  reason: string;
  score: number;
  metadata: Json;
  dedupeKey: string;
}

interface RecommendationRow {
  id: string;
  reason: string;
  score: number;
  updated_at: string;
  source_id: string;
  source_title: string;
  source_summary: string | null;
  source_created_at: string;
  trigger_source_id: string | null;
  trigger_source_title: string | null;
}

export interface KnowledgeRecommendationView {
  id: string;
  reason: string;
  score: number;
  updatedAt: string;
  source: {
    id: string;
    title: string;
    summary: string | null;
    createdAt: string;
  };
  triggerSource: {
    id: string;
    title: string;
  } | null;
}

export async function refreshKnowledgeRecommendationsForProcessedCapture(input: {
  userId: string;
  source: Source;
}) {
  const candidates = await loadRecommendationCandidates(input.userId);
  const trigger = candidates.find((candidate) => candidate.id === input.source.id);

  if (!trigger || isLowSignalTitle(trigger.title)) {
    return;
  }

  const triggerTokens = contentTokens(toRecommendationText(trigger));
  const drafts = candidates
    .filter((candidate) => !isLowSignalTitle(candidate.title))
    .map((candidate) => scoreCandidate(trigger, triggerTokens, candidate))
    .filter((draft): draft is RecommendationDraft => Boolean(draft))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  for (const draft of drafts) {
    await upsertKnowledgeRecommendation(input.userId, draft);
  }
}

export async function loadKnowledgeRecommendations(input: {
  userId: string;
  limit?: number;
}): Promise<KnowledgeRecommendationView[]> {
  const result = await query<RecommendationRow>(
    `
      with ranked as (
        select distinct on (s.id)
          kr.id,
          kr.reason,
          kr.score,
          kr.updated_at,
          s.id as source_id,
          s.title as source_title,
          s.summary as source_summary,
          s.created_at as source_created_at,
          ts.id as trigger_source_id,
          ts.title as trigger_source_title
        from knowledge_recommendations kr
        join sources s on s.id = kr.source_id
        left join captures c on c.id = s.capture_id
        left join sources ts on ts.id = kr.trigger_source_id
        where kr.user_id = $1
          and kr.status = 'active'
          and (c.status is null or c.status <> 'ignored')
          and s.title !~* '(P[0-9]+|SMOKE|TEST|REVIEW|REGRESSION)'
        order by s.id, kr.updated_at desc, kr.score desc
      )
      select *
      from ranked
      order by updated_at desc, score desc
      limit $2
    `,
    [input.userId, input.limit || 5],
  );

  return result.rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    score: row.score,
    updatedAt: row.updated_at,
    source: {
      id: row.source_id,
      title: row.source_title,
      summary: row.source_summary,
      createdAt: row.source_created_at,
    },
    triggerSource:
      row.trigger_source_id && row.trigger_source_title
        ? {
            id: row.trigger_source_id,
            title: row.trigger_source_title,
          }
        : null,
  }));
}

async function loadRecommendationCandidates(userId: string) {
  const result = await query<SourceCandidate>(
    `
      select
        s.id,
        s.title,
        s.summary,
        s.extracted_text,
        c.note,
        s.created_at
      from sources s
      left join captures c on c.id = s.capture_id
      where s.user_id = $1
        and (c.status is null or c.status <> 'ignored')
      order by s.created_at desc
      limit 320
    `,
    [userId],
  );

  return result.rows;
}

function scoreCandidate(
  trigger: SourceCandidate,
  triggerTokens: string[],
  candidate: SourceCandidate,
): RecommendationDraft | null {
  const candidateTokens = contentTokens(toRecommendationText(candidate));
  const similarity = jaccard(triggerTokens, candidateTokens);
  const isTrigger = candidate.id === trigger.id;
  const recency = getRecencyScore(candidate.created_at);
  const hasNote = Boolean(candidate.note?.trim());
  let score = recency * 0.28 + (hasNote ? 0.08 : 0);
  const reasons: string[] = [];

  if (isTrigger) {
    score += 0.55;
    reasons.push("刚刚整理完成");
  }

  if (!isTrigger && similarity >= 0.08) {
    score += Math.min(similarity * 1.7, 0.72);
    reasons.push(`和新资料「${trigger.title}」主题相近`);
  }

  if (hasNote) {
    reasons.push("你保存时写过备注");
  }

  if (recency >= 0.75) {
    reasons.push("最近新增");
  }

  if (score < 0.34 || reasons.length === 0) {
    return null;
  }

  return {
    sourceId: candidate.id,
    triggerSourceId: trigger.id,
    reason: reasons.slice(0, 2).join("；"),
    score: Number(score.toFixed(4)),
    metadata: {
      similarity,
      recency,
      has_note: hasNote,
      trigger_title: trigger.title,
    },
    dedupeKey: `trigger:${trigger.id}:source:${candidate.id}`,
  };
}

async function upsertKnowledgeRecommendation(userId: string, draft: RecommendationDraft) {
  await query<KnowledgeRecommendation>(
    `
      insert into knowledge_recommendations (
        user_id,
        source_id,
        trigger_source_id,
        reason,
        score,
        metadata,
        dedupe_key
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7)
      on conflict (user_id, dedupe_key)
      do update set
        reason = excluded.reason,
        score = excluded.score,
        metadata = excluded.metadata,
        status = 'active',
        updated_at = now()
      where knowledge_recommendations.status <> 'dismissed'
    `,
    [
      userId,
      draft.sourceId,
      draft.triggerSourceId,
      draft.reason,
      draft.score,
      JSON.stringify(draft.metadata),
      draft.dedupeKey,
    ],
  );
}

function toRecommendationText(source: SourceCandidate) {
  return [source.title, source.summary || "", source.extracted_text.slice(0, 3000)].join("\n");
}

function getRecencyScore(value: string) {
  const ageDays = Math.max(0, (Date.now() - new Date(value).getTime()) / 86_400_000);
  return Math.max(0, 1 - ageDays / 30);
}

function isLowSignalTitle(value: string) {
  return /\b(P\d+|SMOKE|TEST|REVIEW|REGRESSION)\b/i.test(value);
}

function contentTokens(value: string) {
  return tokenize(value.slice(0, 6000)).slice(0, 260);
}

function tokenize(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const latin = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const cjk = Array.from(value.matchAll(/[\u3400-\u9fff]{2,}/g)).flatMap((match) => toBigrams(match[0]));
  return Array.from(new Set([...latin, ...cjk])).slice(0, 500);
}

function toBigrams(value: string) {
  const chars = Array.from(value);
  const bigrams: string[] = [];

  for (let index = 0; index < chars.length - 1; index += 1) {
    bigrams.push(`${chars[index]}${chars[index + 1]}`);
  }

  return bigrams;
}

function jaccard(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (leftSet.size + rightSet.size - intersection);
}
