import { query } from "@/lib/db";

export interface DuplicateSourceSuggestion {
  sourceId: string;
  title: string;
  originalUrl: string | null;
  createdAt: string;
  score: number;
  reasons: string[];
}

export interface SimilarWikiPageSuggestion {
  wikiPageId: string;
  title: string;
  slug: string;
  updatedAt: string;
  score: number;
  reasons: string[];
}

interface SourceForSuggestion {
  id: string;
  title: string;
  original_url: string | null;
  extracted_text: string;
  summary: string | null;
  created_at: string;
}

interface WikiForSuggestion {
  id: string;
  title: string;
  slug: string;
  content_markdown: string;
  updated_at: string;
}

interface VectorWikiSuggestionRow {
  id: string;
  title: string;
  slug: string;
  updated_at: string;
  distance: number | null;
}

export async function loadDuplicateSourceSuggestions(input: {
  userId: string;
  sourceId: string;
  limit?: number;
}): Promise<DuplicateSourceSuggestion[]> {
  const sources = await query<SourceForSuggestion>(
    `
      select id, title, original_url, extracted_text, summary, created_at
      from sources
      where user_id = $1
      order by created_at desc
      limit 300
    `,
    [input.userId],
  );
  const target = sources.rows.find((source) => source.id === input.sourceId);

  if (!target) {
    return [];
  }

  return sources.rows
    .filter((source) => source.id !== target.id)
    .map((source) => scoreDuplicateSource(target, source))
    .filter((suggestion) => suggestion.score >= 0.55)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit || 5);
}

export async function loadSimilarWikiPageSuggestions(input: {
  userId: string;
  wikiPageId: string;
  limit?: number;
}): Promise<SimilarWikiPageSuggestion[]> {
  const [vectorSuggestions, wikiPages] = await Promise.all([
    loadVectorWikiSuggestions(input.userId, input.wikiPageId, input.limit || 5).catch(() => []),
    query<WikiForSuggestion>(
      `
        select id, title, slug, content_markdown, updated_at
        from wiki_pages
        where user_id = $1
        order by updated_at desc
        limit 300
      `,
      [input.userId],
    ),
  ]);
  const target = wikiPages.rows.find((page) => page.id === input.wikiPageId);

  if (!target) {
    return [];
  }

  const suggestions = new Map<string, SimilarWikiPageSuggestion>();

  for (const suggestion of vectorSuggestions) {
    suggestions.set(suggestion.wikiPageId, suggestion);
  }

  for (const page of wikiPages.rows) {
    if (page.id === target.id) {
      continue;
    }

    const lexicalSuggestion = scoreSimilarWikiPage(target, page);
    const existing = suggestions.get(page.id);

    if (!existing || lexicalSuggestion.score > existing.score) {
      suggestions.set(page.id, lexicalSuggestion);
    } else if (lexicalSuggestion.score >= 0.45) {
      existing.reasons = Array.from(new Set([...existing.reasons, ...lexicalSuggestion.reasons]));
      existing.score = Math.max(existing.score, lexicalSuggestion.score);
    }
  }

  return Array.from(suggestions.values())
    .filter((suggestion) => suggestion.score >= 0.45)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit || 5);
}

async function loadVectorWikiSuggestions(userId: string, wikiPageId: string, limit: number) {
  const result = await query<VectorWikiSuggestionRow>(
    `
      with target_chunks as (
        select embedding
        from chunks
        where user_id = $1
          and parent_type = 'wiki_page'
          and parent_id = $2
          and embedding is not null
        limit 4
      )
      select
        wp.id,
        wp.title,
        wp.slug,
        wp.updated_at,
        min(c.embedding <=> tc.embedding) as distance
      from target_chunks tc
      join chunks c on c.user_id = $1
        and c.parent_type = 'wiki_page'
        and c.parent_id <> $2
        and c.embedding is not null
      join wiki_pages wp on wp.id = c.parent_id
      group by wp.id, wp.title, wp.slug, wp.updated_at
      order by distance asc
      limit $3
    `,
    [userId, wikiPageId, limit],
  );

  return result.rows.map((row) => ({
    wikiPageId: row.id,
    title: row.title,
    slug: row.slug,
    updatedAt: row.updated_at,
    score: row.distance === null ? 0 : 1 / (1 + Number(row.distance)),
    reasons: ["语义相似"],
  }));
}

function scoreDuplicateSource(target: SourceForSuggestion, candidate: SourceForSuggestion): DuplicateSourceSuggestion {
  const reasons: string[] = [];
  let score = 0;

  if (target.original_url && candidate.original_url && normalizeUrl(target.original_url) === normalizeUrl(candidate.original_url)) {
    score += 0.8;
    reasons.push("原始链接相同");
  }

  const titleSimilarity = jaccard(tokenize(target.title), tokenize(candidate.title));
  if (titleSimilarity >= 0.55) {
    score += titleSimilarity * 0.35;
    reasons.push("标题高度相似");
  }

  const bodySimilarity = jaccard(contentTokens(target.extracted_text), contentTokens(candidate.extracted_text));
  if (bodySimilarity >= 0.45) {
    score += bodySimilarity * 0.65;
    reasons.push("正文重复度高");
  }

  const summarySimilarity = jaccard(tokenize(target.summary || ""), tokenize(candidate.summary || ""));
  if (summarySimilarity >= 0.5) {
    score += summarySimilarity * 0.2;
    reasons.push("摘要相似");
  }

  return {
    sourceId: candidate.id,
    title: candidate.title,
    originalUrl: candidate.original_url,
    createdAt: candidate.created_at,
    score: Math.min(score, 1),
    reasons,
  };
}

function scoreSimilarWikiPage(target: WikiForSuggestion, candidate: WikiForSuggestion): SimilarWikiPageSuggestion {
  const reasons: string[] = [];
  let score = 0;

  const titleSimilarity = jaccard(tokenize(target.title), tokenize(candidate.title));
  if (titleSimilarity >= 0.4) {
    score += titleSimilarity * 0.45;
    reasons.push("标题相近");
  }

  const contentSimilarity = jaccard(contentTokens(target.content_markdown), contentTokens(candidate.content_markdown));
  if (contentSimilarity >= 0.35) {
    score += contentSimilarity * 0.75;
    reasons.push("内容主题相似");
  }

  return {
    wikiPageId: candidate.id,
    title: candidate.title,
    slug: candidate.slug,
    updatedAt: candidate.updated_at,
    score: Math.min(score, 1),
    reasons,
  };
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";

    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|spm|fbclid|gclid|from|share)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}`;
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function contentTokens(value: string) {
  return tokenize(value.slice(0, 6000)).slice(0, 220);
}

function tokenize(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const latin = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const cjk = Array.from(value.matchAll(/[\u3400-\u9fff]{2,}/g)).flatMap((match) => toBigrams(match[0]));
  return Array.from(new Set([...latin, ...cjk])).slice(0, 400);
}

function toBigrams(value: string) {
  const chars = Array.from(value);
  const bigrams: string[] = [];

  for (let index = 0; index < chars.length - 1; index += 1) {
    bigrams.push(`${chars[index]}${chars[index + 1]}`);
  }

  return bigrams;
}

function jaccard(leftTokens: string[], rightTokens: string[]) {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;

  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (left.size + right.size - intersection);
}
