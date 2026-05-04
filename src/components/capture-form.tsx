"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    saving: "正在保存...",
    saved: "已保存，后台任务已排队。",
    failed: "保存失败。",
    missing: "缺少：",
    url: "链接",
    urlPlaceholder: "https://...",
    text: "文本",
    textPlaceholder: "粘贴文章片段、想法、聊天记录，或补充图片里的文字",
    note: "备注",
    notePlaceholder: "为什么保存它？",
    files: "本地图片",
    filesHint: "可上传截图、长图或文章图片。单张不超过 10MB，一次最多 6 张。",
    fileUrl: "附件链接",
    fileUrlPlaceholder: "可选：图片、截图或文件 URL",
    submit: "保存到收集箱",
    submitSaving: "保存中",
  },
  en: {
    saving: "Saving...",
    saved: "Saved. Background processing has been queued.",
    failed: "Save failed.",
    missing: "Missing: ",
    url: "Link",
    urlPlaceholder: "https://...",
    text: "Text",
    textPlaceholder: "Paste article text, notes, chat logs, or text from an image",
    note: "Note",
    notePlaceholder: "Why are you saving this?",
    files: "Local images",
    filesHint: "Upload screenshots, long images, or article images. Up to 6 images, 10MB each.",
    fileUrl: "Attachment URL",
    fileUrlPlaceholder: "Optional: image, screenshot, or file URL",
    submit: "Save to Inbox",
    submitSaving: "Saving",
  },
} satisfies Record<Locale, Record<string, string>>;

export function CaptureForm({ locale = "zh" }: { locale?: Locale }) {
  const router = useRouter();
  const t = copy[locale];
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setStatus(t.saving);
    setIsSaving(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

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
      setStatus(result.job?.message || t.saved);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="capture-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="url">{t.url}</label>
        <input className="input" id="url" name="url" placeholder={t.urlPlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="text">{t.text}</label>
        <textarea
          className="textarea"
          id="text"
          name="text"
          placeholder={t.textPlaceholder}
        />
      </div>
      <div className="field">
        <label htmlFor="note">{t.note}</label>
        <input className="input" id="note" name="note" placeholder={t.notePlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="files">{t.files}</label>
        <input
          accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif"
          className="input file-input"
          id="files"
          multiple
          name="files"
          type="file"
        />
        <span className="field-hint">{t.filesHint}</span>
      </div>
      <div className="field">
        <label htmlFor="fileUrl">{t.fileUrl}</label>
        <input className="input" id="fileUrl" name="fileUrl" placeholder={t.fileUrlPlaceholder} />
      </div>
      <button className="button" disabled={isSaving} type="submit">
        {isSaving ? t.submitSaving : t.submit}
      </button>
      {status ? <p className="meta">{status}</p> : null}
    </form>
  );
}
