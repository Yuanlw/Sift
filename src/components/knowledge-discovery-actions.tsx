"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { KnowledgeDiscoveryView } from "@/lib/knowledge-discoveries";

const copy = {
  zh: {
    cancel: "取消",
    confirmMerge: "确认合并",
    confirmMerging: "合并中...",
    ignore: "忽略发现",
    ignoreSource: "忽略新资料",
    ignoring: "处理中...",
    ignored: "已忽略。",
    merge: "预览合并",
    mergeFailed: "合并失败。",
    mergePreview: "合并预览",
    mergeSummary: "改动摘要",
    mergeTarget: "将合并到",
    merged: "已合并。",
    previewing: "生成预览...",
    sourceIgnored: "已忽略新资料，原始输入仍保留。",
    failed: "操作失败。",
    title: "标题",
    wikiMarkdown: "合并后正文",
  },
  en: {
    cancel: "Cancel",
    confirmMerge: "Confirm merge",
    confirmMerging: "Merging...",
    ignore: "Ignore",
    ignoreSource: "Ignore new",
    ignoring: "Working...",
    ignored: "Ignored.",
    merge: "Preview merge",
    mergeFailed: "Merge failed.",
    mergePreview: "Merge preview",
    mergeSummary: "Summary",
    mergeTarget: "Merge into",
    merged: "Merged.",
    previewing: "Previewing...",
    sourceIgnored: "New capture ignored. Original input is kept.",
    failed: "Action failed.",
    title: "Title",
    wikiMarkdown: "Merged body",
  },
} satisfies Record<Locale, Record<string, string>>;

interface MergePreviewResponse {
  preview: {
    title: string;
    wikiMarkdown: string;
    summaryOfChanges: string;
    candidate: {
      targetWiki: {
        title: string;
      };
    };
  };
}

export function KnowledgeDiscoveryActions({
  discoveryId,
  locale,
  mergeEligibility,
  type,
}: {
  discoveryId: string;
  locale: Locale;
  mergeEligibility: KnowledgeDiscoveryView["mergeEligibility"];
  type: KnowledgeDiscoveryView["type"];
}) {
  const router = useRouter();
  const t = copy[locale];
  const [pendingAction, setPendingAction] = useState<"commit-merge" | "ignore" | "ignore-source" | "preview-merge" | null>(null);
  const [mergeDraft, setMergeDraft] = useState<MergePreviewResponse["preview"] | null>(null);
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

  async function previewMerge() {
    if (pendingAction) {
      return;
    }

    setPendingAction("preview-merge");
    setStatus(null);

    try {
      const response = await fetch(`/api/discoveries/${discoveryId}/merge`, {
        body: JSON.stringify({ mode: "preview" }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as (MergePreviewResponse & { error?: string }) | null;

      if (!response.ok || !result?.preview) {
        setStatus(result?.error || t.mergeFailed);
        return;
      }

      setMergeDraft(result.preview);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.mergeFailed);
    } finally {
      setPendingAction(null);
    }
  }

  async function commitMerge() {
    if (!mergeDraft || pendingAction) {
      return;
    }

    setPendingAction("commit-merge");
    setStatus(null);

    try {
      const response = await fetch(`/api/discoveries/${discoveryId}/merge`, {
        body: JSON.stringify({
          mode: "commit",
          summaryOfChanges: mergeDraft.summaryOfChanges,
          title: mergeDraft.title,
          wikiMarkdown: mergeDraft.wikiMarkdown,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { error?: string; href?: string; message?: string } | null;

      if (!response.ok) {
        setStatus(result?.error || t.mergeFailed);
        return;
      }

      setStatus(result?.message || t.merged);
      setMergeDraft(null);
      router.refresh();

      if (result?.href) {
        router.push(result.href);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.mergeFailed);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="knowledge-discovery-actions">
      {mergeEligibility.canMerge && (type === "related_wiki" || type === "duplicate_source") ? (
        <button
          className="discovery-action-button discovery-action-primary"
          disabled={Boolean(pendingAction)}
          onClick={() => void previewMerge()}
          type="button"
        >
          {pendingAction === "preview-merge" ? t.previewing : t.merge}
        </button>
      ) : null}
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
      {mergeDraft ? (
        <div className="merge-preview-dialog" role="dialog" aria-modal="false" aria-label={t.mergePreview}>
          <div className="merge-preview-heading">
            <strong>{t.mergePreview}</strong>
            <span className="meta">
              {t.mergeTarget}：{mergeDraft.candidate.targetWiki.title}
            </span>
          </div>
          <label>
            <span>{t.title}</span>
            <input
              onChange={(event) => setMergeDraft({ ...mergeDraft, title: event.target.value })}
              value={mergeDraft.title}
            />
          </label>
          <label>
            <span>{t.mergeSummary}</span>
            <textarea
              onChange={(event) => setMergeDraft({ ...mergeDraft, summaryOfChanges: event.target.value })}
              rows={3}
              value={mergeDraft.summaryOfChanges}
            />
          </label>
          <label>
            <span>{t.wikiMarkdown}</span>
            <textarea
              className="merge-preview-markdown"
              onChange={(event) => setMergeDraft({ ...mergeDraft, wikiMarkdown: event.target.value })}
              rows={12}
              value={mergeDraft.wikiMarkdown}
            />
          </label>
          <div className="merge-preview-actions">
            <button
              className="discovery-action-button"
              disabled={Boolean(pendingAction)}
              onClick={() => setMergeDraft(null)}
              type="button"
            >
              {t.cancel}
            </button>
            <button
              className="discovery-action-button discovery-action-primary"
              disabled={Boolean(pendingAction)}
              onClick={() => void commitMerge()}
              type="button"
            >
              {pendingAction === "commit-merge" ? t.confirmMerging : t.confirmMerge}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
