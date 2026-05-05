"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    archive: "归档知识页",
    restore: "恢复知识页",
    delete: "永久删除",
    archiving: "正在归档...",
    restoring: "正在恢复...",
    deleting: "正在删除...",
    archived: "已归档，默认列表不再显示。",
    restored: "已恢复到默认列表。",
    deleted: "已永久删除知识页。",
    confirmDelete: "永久删除后不可恢复。确定删除这页知识吗？",
    failed: "操作失败。",
  },
  en: {
    archive: "Archive page",
    restore: "Restore page",
    delete: "Delete permanently",
    archiving: "Archiving...",
    restoring: "Restoring...",
    deleting: "Deleting...",
    archived: "Archived and hidden from the default list.",
    restored: "Restored to the default list.",
    deleted: "Wiki page permanently deleted.",
    confirmDelete: "Permanent deletion cannot be undone. Delete this wiki page?",
    failed: "Action failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function WikiArchiveActions({
  isArchived,
  locale,
  slug,
}: {
  isArchived: boolean;
  locale: Locale;
  slug: string;
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
      const response = await fetch(`/api/wiki/${encodeURIComponent(slug)}/archive`, {
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
    if (pending || deleting || !isArchived) {
      return;
    }

    if (!window.confirm(t.confirmDelete)) {
      return;
    }

    setDeleting(true);
    setStatus(t.deleting);

    try {
      const response = await fetch(`/api/wiki/${encodeURIComponent(slug)}/delete`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

      if (!response.ok) {
        setStatus(result?.error || t.failed);
        return;
      }

      setStatus(result?.message || t.deleted);
      router.push("/wiki?view=archived");
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
      {isArchived ? (
        <button
          className="button button-danger"
          disabled={pending || deleting}
          onClick={() => void runDelete()}
          type="button"
        >
          {deleting ? t.deleting : t.delete}
        </button>
      ) : null}
      {status ? <p className="meta">{status}</p> : null}
    </div>
  );
}
