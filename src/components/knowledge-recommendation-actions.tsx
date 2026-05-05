"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    dismiss: "暂不看",
    dismissing: "正在隐藏...",
    dismissed: "已从近期回顾隐藏。",
    failed: "操作失败。",
  },
  en: {
    dismiss: "Dismiss",
    dismissing: "Dismissing...",
    dismissed: "Hidden from recent review.",
    failed: "Action failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function KnowledgeRecommendationActions({
  locale,
  recommendationId,
}: {
  locale: Locale;
  recommendationId: string;
}) {
  const router = useRouter();
  const t = copy[locale];
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function dismiss() {
    if (pending) {
      return;
    }

    setPending(true);
    setStatus(null);

    try {
      const response = await fetch(`/api/recommendations/${recommendationId}/dismiss`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

      if (!response.ok) {
        setStatus(result?.error || t.failed);
        return;
      }

      setStatus(result?.message || t.dismissed);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="recommendation-actions">
      <button
        className="discovery-action-button"
        disabled={pending}
        onClick={() => void dismiss()}
        type="button"
      >
        {pending ? t.dismissing : t.dismiss}
      </button>
      {status ? <span className="meta">{status}</span> : null}
    </div>
  );
}
