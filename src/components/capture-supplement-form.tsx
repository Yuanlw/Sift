"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    title: "补充资料",
    bodyPlaceholder: "粘贴正文、关键片段，或写一句这条资料为什么重要",
    addImages: "添加截图",
    imagesSelected: "张图片",
    submit: "补充并重新处理",
    saving: "正在补充...",
    saved: "已补充，后台会重新处理。",
    failed: "补充失败。",
  },
  en: {
    title: "Supplement",
    bodyPlaceholder: "Paste copied text, key excerpts, or why this capture matters",
    addImages: "Add screenshots",
    imagesSelected: "images",
    submit: "Supplement and retry",
    saving: "Adding supplement...",
    saved: "Supplement saved. Processing will retry.",
    failed: "Supplement failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function CaptureSupplementForm({ captureId, locale }: { captureId: string; locale: Locale }) {
  const router = useRouter();
  const t = copy[locale];
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileCount, setFileCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setStatus(t.saving);

    try {
      const response = await fetch(`/api/captures/${captureId}/supplement`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus(result?.error || t.failed);
        return;
      }

      const result = (await response.json()) as { message?: string };
      formRef.current?.reset();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setFileCount(0);
      setStatus(result.message || t.saved);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="supplement-form" onSubmit={handleSubmit} ref={formRef}>
      <label className="sr-only" htmlFor="supplement-text">
        {t.title}
      </label>
      <textarea
        className="supplement-textarea"
        id="supplement-text"
        name="text"
        placeholder={t.bodyPlaceholder}
      />
      <div className="supplement-actions">
        <label className="composer-tool" htmlFor="supplement-files">
          {t.addImages}
        </label>
        <input
          accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif"
          id="supplement-files"
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
      <button className="button" disabled={isSaving} type="submit">
        {isSaving ? t.saving : t.submit}
      </button>
      {status ? <p className="meta">{status}</p> : null}
    </form>
  );
}
