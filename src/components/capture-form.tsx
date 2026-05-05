"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    saving: "正在保存...",
    saved: "已保存到今日收集。",
    failed: "保存失败。",
    missing: "缺少：",
    placeholder: "丢进来：链接、正文、想法，或者说明这些截图为什么值得保存",
    composerLabel: "收集内容",
    addImages: "添加图片",
    imagesSelected: "张图片",
    detected: "已识别",
    link: "链接",
    text: "文本",
    image: "图片",
    emptyHint: "粘贴链接、长文、聊天记录，或添加截图。",
    mascotLabel: "知识入口",
    noteLabel: "为什么保存",
    notePlaceholder: "可选：写一句以后为什么要回来看",
    submit: "保存",
    submitSaving: "保存中",
  },
  en: {
    saving: "Saving...",
    saved: "Saved to Today.",
    failed: "Save failed.",
    missing: "Missing: ",
    placeholder: "Drop in a link, text, note, or why these screenshots matter",
    composerLabel: "Capture content",
    addImages: "Add images",
    imagesSelected: "images",
    detected: "Detected",
    link: "Link",
    text: "Text",
    image: "Image",
    emptyHint: "Paste a link, long text, chat log, or attach screenshots.",
    mascotLabel: "Knowledge feeder",
    noteLabel: "Why save this",
    notePlaceholder: "Optional: why this will matter later",
    submit: "Save",
    submitSaving: "Saving",
  },
} satisfies Record<Locale, Record<string, string>>;

export function CaptureForm({ locale = "zh" }: { locale?: Locale }) {
  const router = useRouter();
  const t = copy[locale];
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [content, setContent] = useState("");
  const [fileCount, setFileCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detectedKinds = useMemo(() => getDetectedKinds(content, fileCount), [content, fileCount]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setStatus(t.saving);
    setIsSaving(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const parsed = parseComposerContent(content);

    formData.delete("content");
    formData.set("url", parsed.url || "");
    formData.set("text", parsed.text || "");
    formData.set("note", normalizeFormText(formData.get("note")) || "");
    formData.set("fileUrl", "");

    try {
      const response = await fetch("/api/captures", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as
          | { error?: string; missingKeys?: string[] }
          | null;
        const missingKeys = result?.missingKeys?.join(", ");
        setStatus(missingKeys ? `${result?.error} ${t.missing}${missingKeys}` : result?.error || t.failed);
        return;
      }

      const result = (await response.json()) as { job?: { message?: string; status?: string } };
      form.reset();
      setContent("");
      setFileCount(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setStatus(result.job?.message || t.saved);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className={isSaving ? "capture-composer is-feeding" : "capture-composer"} onSubmit={handleSubmit}>
      <PixiuMascot label={t.mascotLabel} />
      <label className="sr-only" htmlFor="content">
        {t.composerLabel}
      </label>
      <textarea
        className="composer-input"
        id="content"
        name="content"
        onChange={(event) => setContent(event.target.value)}
        placeholder={t.placeholder}
        value={content}
      />

      <div className="composer-footer">
        <label className="composer-note" htmlFor="capture-note">
          <span>{t.noteLabel}</span>
          <input id="capture-note" name="note" placeholder={t.notePlaceholder} type="text" />
        </label>

        <div className="composer-tools">
          <label className="composer-tool" htmlFor="files">
            {t.addImages}
          </label>
          <input
            accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif"
            id="files"
            multiple
            name="files"
            onChange={(event) => setFileCount(event.target.files?.length || 0)}
            ref={fileInputRef}
            type="file"
          />
          {fileCount > 0 ? (
            <span className="attachment-count">
              {fileCount} {t.imagesSelected}
            </span>
          ) : null}
        </div>

        <div className="composer-actions">
          <div className="detected-kinds" aria-label={t.detected}>
            {detectedKinds.length > 0 ? (
              detectedKinds.map((kind) => <span key={kind}>{getKindLabel(kind, t)}</span>)
            ) : (
              <span>{t.emptyHint}</span>
            )}
          </div>
          <button className="button composer-submit" disabled={isSaving} type="submit">
            {isSaving ? t.submitSaving : t.submit}
          </button>
        </div>
      </div>

      {status ? <p className="meta">{status}</p> : null}
    </form>
  );
}

function PixiuMascot({ label }: { label: string }) {
  return (
    <div className="pixiu-mascot" aria-label={label} role="img">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" aria-hidden="true" height={180} src="/images/pixiu-feeder.png" width={180} />
    </div>
  );
}

type DetectedKind = "link" | "text" | "image";

function parseComposerContent(value: string) {
  const text = value.trim();
  const urls = extractUrls(text);
  const url = urls[0] || null;
  const body = url ? text.replace(url, "").trim() : text;

  return {
    url,
    text: body || null,
  };
}

function getDetectedKinds(content: string, fileCount: number) {
  const kinds: DetectedKind[] = [];
  const parsed = parseComposerContent(content);

  if (parsed.url) {
    kinds.push("link");
  }

  if (parsed.text) {
    kinds.push("text");
  }

  if (fileCount > 0) {
    kinds.push("image");
  }

  return kinds;
}

function extractUrls(value: string) {
  return Array.from(new Set(value.match(/https?:\/\/[^\s)）\]}>"']+/g) || []));
}

function normalizeFormText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getKindLabel(kind: DetectedKind, t: Record<string, string>) {
  return t[kind];
}
