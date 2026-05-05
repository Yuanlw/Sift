"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

const MAX_IMPORT_ITEMS = 100;

const copy = {
  zh: {
    title: "外部收藏导入",
    trigger: "导入收藏",
    subtitle: "把书签、稍后读链接或一批 URL 先导入今日收集，后台慢慢处理。",
    close: "关闭",
    pasteLabel: "批量链接",
    pastePlaceholder: "每行一个链接；也可以粘贴带标题的链接列表",
    bookmarkLabel: "书签 HTML",
    bookmarkButton: "选择书签文件",
    photosLabel: "相册截图",
    photosButton: "选择多张截图",
    photosSelected: "张截图",
    noteLabel: "批量备注",
    notePlaceholder: "可选：这批收藏来自哪里，为什么要导入",
    detected: "待导入",
    duplicateHint: "同批重复会自动合并，库里已有链接会跳过。",
    submit: "导入到今日收集",
    importing: "导入中",
    empty: "粘贴链接、选择书签 HTML，或选择一组截图。",
    failed: "导入失败。",
    imported: "已导入",
    images: "图片",
    skipped: "已跳过",
    invalid: "无效链接",
    links: "条链接",
  },
  en: {
    title: "External Import",
    trigger: "Import",
    subtitle: "Import bookmarks, read-later links, or a URL batch into Today. Sift processes them in the background.",
    close: "Close",
    pasteLabel: "Bulk links",
    pastePlaceholder: "One URL per line; titled link lists also work",
    bookmarkLabel: "Bookmark HTML",
    bookmarkButton: "Choose bookmark file",
    photosLabel: "Screenshots",
    photosButton: "Choose screenshots",
    photosSelected: "images",
    noteLabel: "Batch note",
    notePlaceholder: "Optional: where this batch came from and why it matters",
    detected: "Ready",
    duplicateHint: "Duplicate links in the same batch are merged; existing captures are skipped.",
    submit: "Import to Today",
    importing: "Importing",
    empty: "Paste links, choose a bookmark HTML file, or select screenshots.",
    failed: "Import failed.",
    imported: "Imported",
    images: "images",
    skipped: "Skipped",
    invalid: "Invalid",
    links: "links",
  },
} satisfies Record<Locale, Record<string, string>>;

type ImportSource = "url_batch" | "bookmark_html" | "photo_batch" | "mixed_import";

interface ImportItem {
  url: string;
  title: string | null;
  text: string | null;
  note: string | null;
  importedAt: string | null;
  metadata: Record<string, string>;
}

export function CaptureImportPanel({ locale = "zh" }: { locale?: Locale }) {
  const router = useRouter();
  const t = copy[locale];
  const [pastedText, setPastedText] = useState("");
  const [bookmarkItems, setBookmarkItems] = useState<ImportItem[]>([]);
  const [bookmarkFileName, setBookmarkFileName] = useState<string | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [batchNote, setBatchNote] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const bookmarkInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pastedItems = useMemo(() => parsePastedLinks(pastedText), [pastedText]);
  const items = useMemo(() => mergeImportItems([...pastedItems, ...bookmarkItems]).slice(0, MAX_IMPORT_ITEMS), [bookmarkItems, pastedItems]);
  const source = getImportSource(pastedItems.length, bookmarkItems.length, photoFiles.length);

  async function handleBookmarkFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const html = await file.text();
    const parsed = parseBookmarkHtml(html);
    setBookmarkFileName(file.name);
    setBookmarkItems(parsed);
    setStatus(`${parsed.length} ${t.links}`);
  }

  function handlePhotoFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    setPhotoFiles(files);
    setStatus(files.length > 0 ? `${files.length} ${t.photosSelected}` : null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if ((items.length === 0 && photoFiles.length === 0) || isImporting) {
      setStatus(t.empty);
      return;
    }

    setIsImporting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/captures/import", buildImportRequest({
        items,
        note: normalizeText(batchNote),
        photoFiles,
        source,
      }));
      const result = (await response.json().catch(() => null)) as
        | { error?: string; summary?: { created: number; images: number; invalid: number; skippedDuplicates: number } }
        | null;

      if (!response.ok) {
        setStatus(result?.error || t.failed);
        return;
      }

      const summary = result?.summary;
      setStatus(
        summary
          ? `${t.imported} ${summary.created}，${t.images} ${summary.images}，${t.skipped} ${summary.skippedDuplicates}，${t.invalid} ${summary.invalid}`
          : t.imported,
      );
      setPastedText("");
      setBookmarkItems([]);
      setBookmarkFileName(null);
      setPhotoFiles([]);
      setBatchNote("");
      if (bookmarkInputRef.current) {
        bookmarkInputRef.current.value = "";
      }
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <button className="composer-tool import-trigger" onClick={() => setIsOpen(true)} type="button">
        {t.trigger}
      </button>

      {isOpen ? (
        <div className="import-modal-backdrop" role="presentation">
          <form aria-label={t.title} className="import-panel import-modal" onSubmit={handleSubmit}>
            <div className="import-panel-heading">
              <div>
                <div className="eyebrow">{t.title}</div>
                <h2>{t.subtitle}</h2>
              </div>
              <button className="import-modal-close" onClick={() => setIsOpen(false)} type="button">
                {t.close}
              </button>
            </div>
            <p className="meta">{t.duplicateHint}</p>

            <div className="import-grid">
              <label className="import-field" htmlFor="bulk-links">
                <span>{t.pasteLabel}</span>
                <textarea
                  id="bulk-links"
                  onChange={(event) => setPastedText(event.target.value)}
                  placeholder={t.pastePlaceholder}
                  value={pastedText}
                />
              </label>

              <div className="import-side">
                <label className="import-field" htmlFor="batch-note">
                  <span>{t.noteLabel}</span>
                  <input
                    id="batch-note"
                    onChange={(event) => setBatchNote(event.target.value)}
                    placeholder={t.notePlaceholder}
                    type="text"
                    value={batchNote}
                  />
                </label>
                <div className="import-file-row">
                  <span>{t.bookmarkLabel}</span>
                  <label className="composer-tool" htmlFor="bookmark-file">
                    {t.bookmarkButton}
                  </label>
                  <input
                    accept=".html,.htm,text/html"
                    id="bookmark-file"
                    onChange={handleBookmarkFile}
                    ref={bookmarkInputRef}
                    type="file"
                  />
                  {bookmarkFileName ? <small>{bookmarkFileName}</small> : null}
                </div>
                <div className="import-file-row">
                  <span>{t.photosLabel}</span>
                  <label className="composer-tool" htmlFor="photo-files">
                    {t.photosButton}
                  </label>
                  <input
                    accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif"
                    id="photo-files"
                    multiple
                    onChange={handlePhotoFiles}
                    ref={photoInputRef}
                    type="file"
                  />
                  {photoFiles.length > 0 ? (
                    <small>
                      {photoFiles.length} {t.photosSelected}
                    </small>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="import-actions">
              <div className="detected-kinds" aria-label={t.detected}>
                {items.length > 0 ? <span>{items.length} {t.links}</span> : null}
                {photoFiles.length > 0 ? <span>{photoFiles.length} {t.photosSelected}</span> : null}
                {items.length === 0 && photoFiles.length === 0 ? <span>{t.empty}</span> : null}
              </div>
              <button className="button composer-submit" disabled={isImporting || (items.length === 0 && photoFiles.length === 0)} type="submit">
                {isImporting ? t.importing : t.submit}
              </button>
            </div>

            {status ? <p className="meta">{status}</p> : null}
          </form>
        </div>
      ) : null}
    </>
  );
}

function parsePastedLinks(value: string): ImportItem[] {
  return value
    .split(/\n+/)
    .flatMap((line) => parseLinkLine(line))
    .filter((item): item is ImportItem => Boolean(item));
}

function parseLinkLine(line: string): ImportItem[] {
  const trimmed = line.trim();
  const url = extractUrls(trimmed)[0];

  if (!url) {
    return [];
  }

  const title = trimmed.replace(url, "").replace(/^[-*\d.\s:：|]+/, "").trim();

  return [{
    url,
    title: title || null,
    text: null,
    note: null,
    importedAt: null,
    metadata: {
      sourceLine: trimmed.slice(0, 400),
    },
  }];
}

function parseBookmarkHtml(html: string): ImportItem[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  return Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const title = anchor.textContent?.trim() || null;
      const addDate = anchor.getAttribute("add_date");

      return {
        url: href,
        title,
        text: null,
        note: null,
        importedAt: addDate ? unixSecondsToIso(addDate) : null,
        metadata: {
          addDate: addDate || "",
        },
      } satisfies ImportItem;
    })
    .filter((item) => item.url.startsWith("http://") || item.url.startsWith("https://"));
}

function mergeImportItems(items: ImportItem[]) {
  const seen = new Set<string>();
  const merged: ImportItem[] = [];

  for (const item of items) {
    const normalizedUrl = normalizeUrl(item.url);

    if (!normalizedUrl || seen.has(normalizedUrl)) {
      continue;
    }

    seen.add(normalizedUrl);
    merged.push({
      ...item,
      url: normalizedUrl,
    });
  }

  return merged;
}

function getImportSource(pastedCount: number, bookmarkCount: number, photoCount: number): ImportSource {
  const sourceCount = [pastedCount > 0, bookmarkCount > 0, photoCount > 0].filter(Boolean).length;

  if (sourceCount > 1) {
    return "mixed_import";
  }

  if (photoCount > 0) {
    return "photo_batch";
  }

  return bookmarkCount > 0 ? "bookmark_html" : "url_batch";
}

function extractUrls(value: string) {
  return Array.from(new Set(value.match(/https?:\/\/[^\s)）\]}>"']+/g) || []));
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function unixSecondsToIso(value: string) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function normalizeText(value: string) {
  return value.trim() || null;
}

function buildImportRequest(input: {
  items: ImportItem[];
  note: string | null;
  photoFiles: File[];
  source: ImportSource;
}) {
  if (input.photoFiles.length === 0) {
    return {
      body: JSON.stringify({
        source: input.source,
        note: input.note,
        skipDuplicates: true,
        items: input.items,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    };
  }

  const formData = new FormData();
  formData.set("source", input.source);
  formData.set("note", input.note || "");
  formData.set("skipDuplicates", "true");
  formData.set("items", JSON.stringify(input.items));
  formData.set(
    "imageMetadata",
    JSON.stringify(input.photoFiles.map((file) => ({
      lastModified: file.lastModified,
      name: file.name,
    }))),
  );

  for (const file of input.photoFiles) {
    formData.append("files", file);
  }

  return {
    body: formData,
    method: "POST",
  };
}
