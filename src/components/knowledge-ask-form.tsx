"use client";

import Link from "next/link";
import { useState } from "react";
import { FormattedAnswer } from "@/components/formatted-answer";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    aria: "问整个知识库",
    eyebrow: "全库问答",
    title: "问整个知识库",
    placeholder: "例如：我保存过哪些关于 Prompt Caching 的资料？这些资料的核心判断是什么？",
    submit: "提问",
    loading: "检索和分析中...",
    failed: "问答失败。",
    retrieval: "查看召回片段",
    vector: "语义",
    keyword: "关键词",
    titleScore: "标题",
    source: "来源资料",
    wiki: "知识页",
  },
  en: {
    aria: "Ask the knowledge base",
    eyebrow: "Knowledge Ask",
    title: "Ask the whole knowledge base",
    placeholder: "Example: What have I saved about Prompt Caching, and what are the key takeaways?",
    submit: "Ask",
    loading: "Searching and analyzing...",
    failed: "Question failed.",
    retrieval: "Show retrieved snippets",
    vector: "semantic",
    keyword: "keyword",
    titleScore: "title",
    source: "source",
    wiki: "wiki page",
  },
} satisfies Record<Locale, Record<string, string>>;

interface KnowledgeAnswer {
  answer: string;
  citations: Array<{
    label: string;
    title: string;
    sourceId?: string;
    wikiSlug?: string;
    originalUrl?: string | null;
  }>;
  retrieval?: {
    contexts: Array<{
      label: string;
      title: string;
      parentType: "source" | "wiki_page";
      sourceId?: string | null;
      wikiSlug?: string | null;
      preview: string;
      score: number;
      matchReasons: string[];
      scores: {
        vector: number;
        keyword: number;
        title: number;
      };
    }>;
  };
}

export function KnowledgeAskForm({ locale = "zh" }: { locale?: Locale }) {
  const t = copy[locale];
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAnswer(null);
    setError(null);
    setIsLoading(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const question = String(formData.get("question") || "").trim();

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        body: JSON.stringify({ question }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const result = (await response.json().catch(() => null)) as (KnowledgeAnswer & { error?: string }) | null;

      if (!response.ok) {
        setError(result?.error || t.failed);
        return;
      }

      setAnswer(result);
      form.reset();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="ask-panel ask-panel-global" aria-label={t.aria}>
      <div>
        <div className="eyebrow">{t.eyebrow}</div>
        <h2>{t.title}</h2>
      </div>
      <form className="ask-form" onSubmit={handleSubmit}>
        <textarea
          className="textarea"
          name="question"
          placeholder={t.placeholder}
          required
        />
        <button className="button" disabled={isLoading} type="submit">
          {isLoading ? t.loading : t.submit}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}

      {answer ? (
        <div className="answer-block">
          <FormattedAnswer text={answer.answer} />
          {answer.citations.length > 0 ? (
            <div className="citation-list">
              {answer.citations.map((citation) => (
                <CitationLink citation={citation} key={`${citation.label}-${citation.title}`} />
              ))}
            </div>
          ) : null}
          {answer.retrieval?.contexts.length ? (
            <details className="retrieval-details">
              <summary>{t.retrieval}</summary>
              <div className="retrieval-list">
                {answer.retrieval.contexts.map((context) => (
                  <div className="retrieval-item" key={`${context.label}-${context.title}`}>
                    <strong>
                      [{context.label}] {context.title}
                    </strong>
                    <span className="meta">
                      {context.parentType === "source" ? t.source : t.wiki} · score {context.score.toFixed(2)} ·{" "}
                      {context.matchReasons.join(" / ")}
                    </span>
                    <p>{context.preview}</p>
                    <span className="meta">
                      {t.vector} {context.scores.vector.toFixed(2)} · {t.keyword}{" "}
                      {context.scores.keyword.toFixed(2)} · {t.titleScore} {context.scores.title.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CitationLink({
  citation,
}: {
  citation: KnowledgeAnswer["citations"][number];
}) {
  const href = citation.sourceId
    ? `/sources/${citation.sourceId}`
    : citation.wikiSlug
      ? `/wiki/${citation.wikiSlug}`
      : citation.originalUrl || "";

  if (!href) {
    return (
      <span className="citation-pill">
        [{citation.label}] {citation.title}
      </span>
    );
  }

  if (href.startsWith("http")) {
    return (
      <a className="citation-pill" href={href} rel="noreferrer" target="_blank">
        [{citation.label}] {citation.title}
      </a>
    );
  }

  return (
    <Link className="citation-pill" href={href}>
      [{citation.label}] {citation.title}
    </Link>
  );
}
