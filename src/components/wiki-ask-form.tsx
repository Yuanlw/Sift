"use client";

import { useState } from "react";
import { FormattedAnswer } from "@/components/formatted-answer";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    aria: "问当前知识页",
    eyebrow: "单页问答",
    title: "基于这页资料提问",
    placeholder: "例如：这份资料最值得复用的结论是什么？",
    loading: "思考中...",
    submit: "提问",
    failed: "问答失败。",
  },
  en: {
    aria: "Ask this wiki page",
    eyebrow: "Page Ask",
    title: "Ask about this page",
    placeholder: "Example: What is the most reusable takeaway from this page?",
    loading: "Thinking...",
    submit: "Ask",
    failed: "Question failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

interface WikiAnswer {
  answer: string;
  citations: Array<{
    label: string;
    title: string;
    sourceId?: string;
    originalUrl?: string | null;
  }>;
}

export function WikiAskForm({ locale = "zh", slug }: { locale?: Locale; slug: string }) {
  const t = copy[locale];
  const [answer, setAnswer] = useState<WikiAnswer | null>(null);
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
      const response = await fetch(`/api/wiki/${encodeURIComponent(slug)}/ask`, {
        method: "POST",
        body: JSON.stringify({ question }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = (await response.json().catch(() => null)) as (WikiAnswer & { error?: string }) | null;

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
    <section className="ask-panel" aria-label={t.aria}>
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
                <span className="citation-pill" key={`${citation.label}-${citation.title}`}>
                  [{citation.label}] {citation.title}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
