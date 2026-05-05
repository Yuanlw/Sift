"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { KnowledgeDiscoveryView } from "@/lib/knowledge-discoveries";

const copy = {
  zh: {
    ignore: "忽略发现",
    ignoreSource: "忽略新资料",
    ignoring: "处理中...",
    ignored: "已忽略。",
    sourceIgnored: "已忽略新资料，原始输入仍保留。",
    failed: "操作失败。",
  },
  en: {
    ignore: "Ignore",
    ignoreSource: "Ignore new",
    ignoring: "Working...",
    ignored: "Ignored.",
    sourceIgnored: "New capture ignored. Original input is kept.",
    failed: "Action failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function KnowledgeDiscoveryActions({
  discoveryId,
  locale,
  type,
}: {
  discoveryId: string;
  locale: Locale;
  type: KnowledgeDiscoveryView["type"];
}) {
  const router = useRouter();
  const t = copy[locale];
  const [pendingAction, setPendingAction] = useState<"ignore" | "ignore-source" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function runAction(action: "ignore" | "ignore-source") {
    if (pendingAction) {
      return;
    }

    setPendingAction(action);
    setStatus(null);

    try {
      const response = await fetch(`/api/discoveries/${discoveryId}/${action}`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;

      if (!response.ok) {
        setStatus(result?.error || t.failed);
        return;
      }

      setStatus(result?.message || (action === "ignore-source" ? t.sourceIgnored : t.ignored));
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="knowledge-discovery-actions">
      <button
        className="discovery-action-button"
        disabled={Boolean(pendingAction)}
        onClick={() => void runAction("ignore")}
        type="button"
      >
        {pendingAction === "ignore" ? t.ignoring : t.ignore}
      </button>
      {type === "duplicate_source" ? (
        <button
          className="discovery-action-button discovery-action-danger"
          disabled={Boolean(pendingAction)}
          onClick={() => void runAction("ignore-source")}
          type="button"
        >
          {pendingAction === "ignore-source" ? t.ignoring : t.ignoreSource}
        </button>
      ) : null}
      {status ? <span className="meta">{status}</span> : null}
    </div>
  );
}
