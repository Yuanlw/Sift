"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    confirm: "这会把当前知识页正文恢复到这次合并前，并暂停这次合并带来的活跃来源关系。确定恢复吗？",
    failed: "恢复失败。",
    restore: "恢复到合并前",
    restored: "已恢复。",
    restoring: "恢复中...",
  },
  en: {
    confirm: "This restores the current wiki content to before this merge and pauses active source relations from this merge. Restore?",
    failed: "Restore failed.",
    restore: "Restore before merge",
    restored: "Restored.",
    restoring: "Restoring...",
  },
} satisfies Record<Locale, Record<string, string>>;

export function WikiMergeRestoreAction({
  disabledReason,
  historyId,
  locale,
}: {
  disabledReason?: string | null;
  historyId: string;
  locale: Locale;
}) {
  const router = useRouter();
  const t = copy[locale];
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function restore() {
    if (pending || disabledReason) {
      return;
    }

    if (!window.confirm(t.confirm)) {
      return;
    }

    setPending(true);
    setStatus(t.restoring);

    try {
      const response = await fetch(`/api/wiki/merge-histories/${historyId}/restore`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { error?: string; href?: string; message?: string } | null;

      if (!response.ok) {
        setStatus(result?.error || t.failed);
        return;
      }

      setStatus(result?.message || t.restored);
      if (result?.href) {
        router.push(result.href);
      }
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="detail-action-stack">
      <button className="button button-secondary" disabled={pending || Boolean(disabledReason)} onClick={() => void restore()} type="button">
        {pending ? t.restoring : t.restore}
      </button>
      {disabledReason ? <p className="meta">{disabledReason}</p> : status ? <p className="meta">{status}</p> : null}
    </div>
  );
}
