"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";

export interface WikiManagementItem {
  id: string;
  href: string;
  slug: string;
  title: string;
  statusLabel: string;
  statusClass: string;
  preview: string;
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
    archived: "已归档所选知识页。",
    restored: "已恢复所选知识页。",
    deleted: "已永久删除所选知识页。",
    confirmDelete: "永久删除后不可恢复。确定删除所选知识页吗？",
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
    archived: "Selected wiki pages archived.",
    restored: "Selected wiki pages restored.",
    deleted: "Selected wiki pages permanently deleted.",
    confirmDelete: "Permanent deletion cannot be undone. Delete the selected wiki pages?",
    failed: "Action failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function WikiManagementList({
  items,
  locale,
  mode,
}: {
  items: WikiManagementItem[];
  locale: Locale;
  mode: "archive" | "restore";
}) {
  const router = useRouter();
  const t = copy[locale];
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<"archive" | "restore" | "delete" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedSlugs), [selectedSlugs]);
  const actionLabel = mode === "restore" ? t.restore : t.archive;

  function toggle(slug: string) {
    setSelectedSlugs((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
    setStatus(null);
  }

  async function runBulkAction(action: "archive" | "restore" | "delete" = mode) {
    if (pending || selectedSlugs.length === 0) {
      return;
    }

    if (action === "delete" && !window.confirm(t.confirmDelete)) {
      return;
    }

    setPending(true);
    setPendingAction(action);
    setStatus(action === "delete" ? t.deleting : action === "restore" ? t.restoring : t.archiving);

    try {
      const response = await fetch("/api/wiki/bulk-archive", {
        body: JSON.stringify({
          action,
          slugs: selectedSlugs,
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
      setSelectedSlugs([]);
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
          {selectedSlugs.length} {t.selected}
        </span>
        <button
          className={mode === "restore" ? "button button-secondary" : "button button-danger"}
          disabled={selectedSlugs.length === 0 || pending}
          onClick={() => void runBulkAction(mode)}
          type="button"
        >
          {pending && pendingAction === mode ? (mode === "restore" ? t.restoring : t.archiving) : actionLabel}
        </button>
        {mode === "restore" ? (
          <button
            className="button button-danger"
            disabled={selectedSlugs.length === 0 || pending}
            onClick={() => void runBulkAction("delete")}
            type="button"
          >
            {pending && pendingAction === "delete" ? t.deleting : t.delete}
          </button>
        ) : null}
        {status ? <span className="meta">{status}</span> : null}
      </div>
      <div className="list">
        {items.map((item) => (
          <article className={selectedSet.has(item.slug) ? "item management-item is-selected" : "item management-item"} key={item.id}>
            <label className="management-checkbox">
              <input
                checked={selectedSet.has(item.slug)}
                onChange={() => toggle(item.slug)}
                type="checkbox"
              />
              <span>{t.select}</span>
            </label>
            <Link className="management-item-link" href={item.href}>
              <div className="item-header">
                <span className={item.statusClass}>{item.statusLabel}</span>
                <strong>{item.title}</strong>
              </div>
              <p>{item.preview}</p>
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
