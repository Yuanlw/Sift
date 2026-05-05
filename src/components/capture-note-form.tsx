"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";

const copy = {
  zh: {
    label: "为什么保存这条",
    placeholder: "写一句为什么保存、以后怎么用，或它对应哪个主题",
    save: "保存备注",
    saving: "保存中...",
    saved: "备注已保存。",
    failed: "保存失败。",
  },
  en: {
    label: "Why this matters",
    placeholder: "Add why you saved this, how to use it later, or which topic it belongs to",
    save: "Save note",
    saving: "Saving...",
    saved: "Note saved.",
    failed: "Save failed.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function CaptureNoteForm({
  captureId,
  initialNote,
  locale,
}: {
  captureId: string;
  initialNote: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const t = copy[locale];
  const [note, setNote] = useState(initialNote || "");
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
      const response = await fetch(`/api/captures/${captureId}/note`, {
        body: JSON.stringify({ note }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus(result?.error || t.failed);
        return;
      }

      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      setStatus(result?.message || t.saved);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.failed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="note-form" onSubmit={handleSubmit}>
      <label htmlFor="capture-note">{t.label}</label>
      <textarea
        id="capture-note"
        maxLength={2000}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t.placeholder}
        value={note}
      />
      <button className="button button-secondary" disabled={isSaving} type="submit">
        {isSaving ? t.saving : t.save}
      </button>
      {status ? <p className="meta">{status}</p> : null}
    </form>
  );
}
