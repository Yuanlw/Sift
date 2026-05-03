"use client";

import { useState } from "react";

export function CaptureForm() {
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("正在保存...");

    const form = event.currentTarget;
    const formData = new FormData(form);

    const response = await fetch("/api/captures", {
      method: "POST",
      body: JSON.stringify({
        url: formData.get("url"),
        text: formData.get("text"),
        note: formData.get("note"),
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as
        | { error?: string; missingKeys?: string[] }
        | null;
      const missingKeys = result?.missingKeys?.join(", ");
      setStatus(missingKeys ? `${result?.error} 缺少：${missingKeys}` : result?.error || "保存失败。");
      return;
    }

    form.reset();
    setStatus("已保存，后台任务已创建。");
  }

  return (
    <form className="capture-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="url">链接</label>
        <input className="input" id="url" name="url" placeholder="https://..." />
      </div>
      <div className="field">
        <label htmlFor="text">文本</label>
        <textarea
          className="textarea"
          id="text"
          name="text"
          placeholder="粘贴文章片段、想法或截图 OCR 文本"
        />
      </div>
      <div className="field">
        <label htmlFor="note">备注</label>
        <input className="input" id="note" name="note" placeholder="为什么保存它？" />
      </div>
      <button className="button" type="submit">
        保存到 Inbox
      </button>
      {status ? <p className="meta">{status}</p> : null}
    </form>
  );
}
