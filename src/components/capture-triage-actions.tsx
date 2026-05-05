"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    supplement: "补充",
    retry: "重试",
    retryIgnored: "恢复并重试",
    ignore: "忽略",
    retrying: "正在重试...",
    ignoring: "正在忽略...",
    retryDone: "已重新触发后台处理。",
    ignoreDone: "已忽略，原始资料仍保留。",
    failed: "操作失败。",
  },
  en: {
    supplement: "Supplement",
    retry: "Retry",
    retryIgnored: "Restore and retry",
    ignore: "Ignore",
    retrying: "Retrying...",
    ignoring: "Ignoring...",
    retryDone: "Processing has been retried.",
    ignoreDone: "Ignored. Original input is still kept.",
    failed: "Action failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function CaptureTriageActions({
  captureId,
  isIgnored = false,
  locale,
  showSupplement = true,
}: {
  captureId: string;
  isIgnored?: boolean;
  locale: Locale;
  showSupplement?: boolean;
}) {
  const router = useRouter();
  const t = copy[locale];
  const [status, setStatus] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"retry" | "ignore" | null>(null);

  async function runAction(action: "retry" | "ignore") {
    if (pendingAction) {
      return;
    }

    setPendingAction(action);
    setStatus(action === "retry" ? t.retrying : t.ignoring);

    try {
      const response = await fetch(`/api/captures/${captureId}/${action}`, {
        method: "POST",
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus(result?.error || t.failed);
        return;
      }

      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      setStatus(result?.message || (action === "retry" ? t.retryDone : t.ignoreDone));
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="capture-actions">
      <div className="capture-action-buttons">
        {showSupplement ? (
          <Link className="button button-secondary" href={`/inbox/${captureId}#supplement`}>
            {t.supplement}
          </Link>
        ) : null}
        <button
          className="button button-secondary"
          disabled={Boolean(pendingAction)}
          onClick={() => void runAction("retry")}
          type="button"
        >
          {pendingAction === "retry" ? t.retrying : isIgnored ? t.retryIgnored : t.retry}
        </button>
        {!isIgnored ? (
          <button
            className="button button-danger"
            disabled={Boolean(pendingAction)}
            onClick={() => void runAction("ignore")}
            type="button"
          >
            {pendingAction === "ignore" ? t.ignoring : t.ignore}
          </button>
        ) : null}
      </div>
      {status ? <p className="meta">{status}</p> : null}
    </div>
  );
}
