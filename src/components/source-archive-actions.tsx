"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    archive: "归档来源",
    restore: "恢复来源",
    delete: "永久删除",
    archiving: "正在归档...",
    restoring: "正在恢复...",
    deleting: "正在删除...",
    archived: "已归档，默认列表不再显示。",
    restored: "已恢复到默认列表。",
    deleted: "已永久删除来源资料。",
    confirmDelete: "永久删除后不可恢复，会同步清理由它生成且没有其他来源支撑的知识页。确定删除这条来源吗？",
    failed: "操作失败。",
  },
  en: {
    archive: "Archive source",
    restore: "Restore source",
    delete: "Delete permanently",
    archiving: "Archiving...",
    restoring: "Restoring...",
    deleting: "Deleting...",
    archived: "Archived and hidden from the default list.",
    restored: "Restored to the default list.",
    deleted: "Source permanently deleted.",
    confirmDelete: "Permanent deletion cannot be undone. It also removes wiki pages generated only from this source. Delete this source?",
    failed: "Action failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function SourceArchiveActions({
  isArchived,
  locale,
  sourceId,
}: {
  isArchived: boolean;
  locale: Locale;
  sourceId: string;
}) {
  const router = useRouter();
  const t = copy[locale];
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const action = isArchived ? "restore" : "archive";

  async function runAction() {
    if (pending) {
      return;
    }

    setPending(true);
    setStatus(isArchived ? t.restoring : t.archiving);

    try {
      const response = await fetch(`/api/sources/${sourceId}/archive`, {
        body: JSON.stringify({ action }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

      if (!response.ok) {
        setStatus(result?.error || t.failed);
        return;
      }

      setStatus(result?.message || (isArchived ? t.restored : t.archived));
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setPending(false);
    }
  }

  async function runDelete() {
    if (pending || deleting) {
      return;
    }

    if (!window.confirm(t.confirmDelete)) {
      return;
    }

    setDeleting(true);
    setStatus(t.deleting);

    try {
      const response = await fetch(`/api/sources/${sourceId}/delete`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

      if (!response.ok) {
        setStatus(result?.error || t.failed);
        return;
      }

      setStatus(result?.message || t.deleted);
      router.push("/sources?view=archived");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="detail-action-stack">
      <button
        className={isArchived ? "button button-secondary" : "button button-danger"}
        disabled={pending || deleting}
        onClick={() => void runAction()}
        type="button"
      >
        {pending ? (isArchived ? t.restoring : t.archiving) : isArchived ? t.restore : t.archive}
      </button>
      <button
        className="button button-danger"
        disabled={pending || deleting}
        onClick={() => void runDelete()}
        type="button"
      >
        {deleting ? t.deleting : t.delete}
      </button>
      {status ? <p className="meta">{status}</p> : null}
    </div>
  );
}
