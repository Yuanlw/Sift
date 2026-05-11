"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";

export interface SourceManagementItem {
  id: string;
  href: string;
  title: string;
  typeLabel: string;
  summary: string | null;
  meta: string;
}

const copy = {
  zh: {
    select: "选择",
    selected: "已选",
    archive: "批量归档",
    restore: "批量恢复",
    delete: "永久删除",
    archiving: "正在归档...",
    restoring: "正在恢复...",
    deleting: "正在删除...",
    archived: "已归档所选来源。",
    restored: "已恢复所选来源。",
    deleted: "已永久删除所选来源。",
    confirmDelete: "永久删除后不可恢复，会同步清理由所选来源独占的知识页。确定删除所选来源吗？",
    failed: "操作失败。",
  },
  en: {
    select: "Select",
    selected: "selected",
    archive: "Archive selected",
    restore: "Restore selected",
    delete: "Delete permanently",
    archiving: "Archiving...",
    restoring: "Restoring...",
    deleting: "Deleting...",
    archived: "Selected sources archived.",
    restored: "Selected sources restored.",
    deleted: "Selected sources permanently deleted.",
    confirmDelete: "Permanent deletion cannot be undone. It also removes wiki pages only linked to the selected sources. Delete the selected sources?",
    failed: "Action failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function SourceManagementList({
  items,
  locale,
  mode,
}: {
  items: SourceManagementItem[];
  locale: Locale;
  mode: "archive" | "restore";
}) {
  const router = useRouter();
  const t = copy[locale];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<"archive" | "restore" | "delete" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const actionLabel = mode === "restore" ? t.restore : t.archive;

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setStatus(null);
  }

  async function runBulkAction(action: "archive" | "restore" | "delete" = mode) {
    if (pending || selectedIds.length === 0) {
      return;
    }

    if (action === "delete" && !window.confirm(t.confirmDelete)) {
      return;
    }

    setPending(true);
    setPendingAction(action);
    setStatus(action === "delete" ? t.deleting : action === "restore" ? t.restoring : t.archiving);

    try {
      const response = await fetch("/api/sources/bulk-archive", {
        body: JSON.stringify({
          action,
          ids: selectedIds,
        }),
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

      setStatus(result?.message || getSuccessCopy(action, t));
      setSelectedIds([]);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setPending(false);
      setPendingAction(null);
    }
  }

  return (
    <div className="management-list-shell">
      <div className="bulk-action-bar">
        <span className="meta">
          {selectedIds.length} {t.selected}
        </span>
        <button
          className={mode === "restore" ? "button button-secondary" : "button button-danger"}
          disabled={selectedIds.length === 0 || pending}
          onClick={() => void runBulkAction(mode)}
          type="button"
        >
          {pending && pendingAction === mode ? (mode === "restore" ? t.restoring : t.archiving) : actionLabel}
        </button>
        <button
          className="button button-danger"
          disabled={selectedIds.length === 0 || pending}
          onClick={() => void runBulkAction("delete")}
          type="button"
        >
          {pending && pendingAction === "delete" ? t.deleting : t.delete}
        </button>
        {status ? <span className="meta">{status}</span> : null}
      </div>
      <div className="list">
        {items.map((item) => (
          <article className={selectedSet.has(item.id) ? "item management-item is-selected" : "item management-item"} key={item.id}>
            <label className="management-checkbox">
              <input
                checked={selectedSet.has(item.id)}
                onChange={() => toggle(item.id)}
                type="checkbox"
              />
              <span>{t.select}</span>
            </label>
            <Link className="management-item-link" href={item.href}>
              <div className="item-header">
                <span className="type-pill">{item.typeLabel}</span>
                <strong>{item.title}</strong>
              </div>
              {item.summary ? <p>{item.summary}</p> : null}
              <span className="meta">{item.meta}</span>
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}

function getSuccessCopy(action: "archive" | "restore" | "delete", t: Record<string, string>) {
  if (action === "archive") {
    return t.archived;
  }

  if (action === "restore") {
    return t.restored;
  }

  return t.deleted;
}
