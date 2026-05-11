"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { UserModelSettings } from "@/lib/model-settings";

type Target = "text" | "embedding" | "vision";
type FormState = {
  embeddingApiKey: string;
  embeddingBaseUrl: string;
  embeddingDimensions: string;
  embeddingModel: string;
  textApiKey: string;
  textBaseUrl: string;
  textModel: string;
  textReasoningEffort: string;
  textThinking: string;
  visionApiKey: string;
  visionBaseUrl: string;
  visionModel: string;
};
type FormFieldName = keyof FormState;

export function ModelSettingsForm({
  initialSettings,
  locale = "zh",
}: {
  initialSettings: UserModelSettings;
  locale?: Locale;
}) {
  const [mode, setMode] = useState(initialSettings.mode);
  const [form, setForm] = useState<FormState>({
    embeddingApiKey: "",
    embeddingBaseUrl: initialSettings.embeddingBaseUrl || "",
    embeddingDimensions: String(initialSettings.embeddingDimensions || 1024),
    embeddingModel: initialSettings.embeddingModel || "",
    textApiKey: "",
    textBaseUrl: initialSettings.textBaseUrl || "",
    textModel: initialSettings.textModel || "",
    textReasoningEffort: initialSettings.textReasoningEffort || "",
    textThinking: initialSettings.textThinking || "",
    visionApiKey: "",
    visionBaseUrl: initialSettings.visionBaseUrl || "",
    visionModel: initialSettings.visionModel || "",
  });
  const [keyConfigured, setKeyConfigured] = useState({
    embedding: initialSettings.embeddingApiKeyConfigured,
    text: initialSettings.textApiKeyConfigured,
    vision: initialSettings.visionApiKeyConfigured,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [validating, setValidating] = useState<Target | null>(null);

  async function save() {
    setStatus(t("保存中...", "Saving..."));
    const response = await fetch("/api/settings/model", {
      body: JSON.stringify({
        mode,
        textBaseUrl: form.textBaseUrl || null,
        textApiKey: form.textApiKey || null,
        textModel: form.textModel || null,
        textThinking: form.textThinking || null,
        textReasoningEffort: form.textReasoningEffort || null,
        embeddingBaseUrl: form.embeddingBaseUrl || null,
        embeddingApiKey: form.embeddingApiKey || null,
        embeddingModel: form.embeddingModel || null,
        embeddingDimensions: Number(form.embeddingDimensions) || null,
        visionBaseUrl: form.visionBaseUrl || null,
        visionApiKey: form.visionApiKey || null,
        visionModel: form.visionModel || null,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setStatus(result?.error || t("保存失败。", "Save failed."));
      return;
    }

    setForm((current) => ({
      ...current,
      embeddingApiKey: "",
      textApiKey: "",
      visionApiKey: "",
    }));
    setKeyConfigured((current) => ({
      embedding: current.embedding || Boolean(form.embeddingApiKey),
      text: current.text || Boolean(form.textApiKey),
      vision: current.vision || Boolean(form.visionApiKey),
    }));
    setStatus(t("已保存。新处理和问答会使用当前配置。", "Saved. New processing and Ask requests will use this configuration."));
  }

  async function validate(target: Target) {
    const payload = getValidationPayload(target);

    if (!payload) {
      setStatus(t("请先填写该模型的接口地址、API 密钥和模型名称。", "Fill in Base URL, API key, and model first."));
      return;
    }

    setValidating(target);
    setStatus(t("验证中...", "Validating..."));
    const response = await fetch("/api/settings/model/validate", {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json().catch(() => null)) as { error?: string; result?: { durationMs?: number; dimensions?: number; outputPreview?: string } } | null;
    setValidating(null);

    if (!response.ok) {
      setStatus(`${getTargetLabel(target)} ${t("验证失败", "validation failed")}：${result?.error || response.status}`);
      return;
    }

    const detail = result?.result?.dimensions
      ? `${t("维度", "dimensions")} ${result.result.dimensions}`
      : result?.result?.outputPreview || "OK";
    setStatus(`${getTargetLabel(target)} ${t("验证通过", "validated")}：${detail} · ${result?.result?.durationMs || 0}ms`);
  }

  function getValidationPayload(target: Target) {
    if (target === "text") {
      if (!form.textBaseUrl || !form.textModel || (!form.textApiKey && !keyConfigured.text)) return null;
      return { apiKey: form.textApiKey || null, baseUrl: form.textBaseUrl, model: form.textModel, target };
    }

    if (target === "embedding") {
      if (!form.embeddingBaseUrl || !form.embeddingModel || (!form.embeddingApiKey && !keyConfigured.embedding)) return null;
      return {
        apiKey: form.embeddingApiKey || null,
        baseUrl: form.embeddingBaseUrl,
        dimensions: Number(form.embeddingDimensions) || null,
        model: form.embeddingModel,
        target,
      };
    }

    if (!form.visionBaseUrl || !form.visionModel || (!form.visionApiKey && !keyConfigured.vision)) return null;
    return { apiKey: form.visionApiKey || null, baseUrl: form.visionBaseUrl, model: form.visionModel, target };
  }

  function update(name: FormFieldName, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function t(zh: string, en: string) {
    return locale === "en" ? en : zh;
  }

  function getTargetLabel(target: Target) {
    const labels: Record<Target, string> = {
      embedding: t("向量模型", "Embedding"),
      text: t("文本模型", "Text model"),
      vision: t("OCR 模型", "OCR model"),
    };
    return labels[target];
  }

  return (
    <div className="model-settings-form">
      <div className="model-mode-selector" role="radiogroup" aria-label={t("模型模式", "Model mode")}>
        <label className={mode === "default" ? "is-selected" : ""}>
          <input checked={mode === "default"} name="model-mode" onChange={() => setMode("default")} type="radio" />
          <strong>{t("省心模式：使用 Sift 默认模型", "Hassle-free: use Sift default models")}</strong>
          <span>{t("不需要配置 API 密钥；只显示能力、额度和健康状态。", "No API key setup; only capability, quota, and health are shown.")}</span>
        </label>
        <label className={mode === "custom" ? "is-selected" : ""}>
          <input checked={mode === "custom"} name="model-mode" onChange={() => setMode("custom")} type="radio" />
          <strong>{t("高级模式：本地模型 / 自带密钥", "Advanced: local models / BYOK")}</strong>
          <span>{t("你提供本地网关、API 密钥或企业模型网关；Sift 只保存配置并调用。", "You provide a local gateway, API key, or company model gateway; Sift stores and calls them.")}</span>
        </label>
      </div>

      {mode === "default" ? (
        <div className="settings-note-grid">
          <div className="settings-note">
            <strong>{t("文本理解", "Text understanding")}</strong>
            <p>{t("用于资料整理、知识页生成、全库问答和单页问答。", "Used for structuring, wiki generation, global Ask, and page Ask.")}</p>
          </div>
          <div className="settings-note">
            <strong>{t("语义检索", "Semantic retrieval")}</strong>
            <p>{t("用于相似资料、管理搜索和问答召回。", "Used for similar items, management search, and Ask retrieval.")}</p>
          </div>
          <div className="settings-note">
            <strong>{t("图片 OCR", "Image OCR")}</strong>
            <p>{t("用于截图和相册图片文字识别。", "Used for screenshots and photo text extraction.")}</p>
          </div>
        </div>
      ) : (
        <div className="custom-model-grid">
          <ModelConfigBlock
            apiKeyConfigured={keyConfigured.text}
            fields={[
              { label: t("接口地址", "Base URL"), name: "textBaseUrl", value: form.textBaseUrl },
              { label: t("API 密钥", "API Key"), name: "textApiKey", secret: true, value: form.textApiKey },
              { label: t("模型名称", "Model"), name: "textModel", value: form.textModel },
            ]}
            onChange={update}
            onValidate={() => validate("text")}
            locale={locale}
            title={t("文本大模型", "Text model")}
            validating={validating === "text"}
          />
          <ModelConfigBlock
            apiKeyConfigured={keyConfigured.embedding}
            fields={[
              { label: t("接口地址", "Base URL"), name: "embeddingBaseUrl", value: form.embeddingBaseUrl },
              { label: t("API 密钥", "API Key"), name: "embeddingApiKey", secret: true, value: form.embeddingApiKey },
              { label: t("模型名称", "Model"), name: "embeddingModel", value: form.embeddingModel },
              { label: t("向量维度", "Dimensions"), name: "embeddingDimensions", value: form.embeddingDimensions },
            ]}
            onChange={update}
            onValidate={() => validate("embedding")}
            locale={locale}
            title={t("向量模型", "Embedding model")}
            validating={validating === "embedding"}
          />
          <ModelConfigBlock
            apiKeyConfigured={keyConfigured.vision}
            fields={[
              { label: t("接口地址", "Base URL"), name: "visionBaseUrl", value: form.visionBaseUrl },
              { label: t("API 密钥", "API Key"), name: "visionApiKey", secret: true, value: form.visionApiKey },
              { label: t("模型名称", "Model"), name: "visionModel", value: form.visionModel },
            ]}
            onChange={update}
            onValidate={() => validate("vision")}
            locale={locale}
            title={t("视觉 OCR 模型", "Vision OCR model")}
            validating={validating === "vision"}
          />
        </div>
      )}

      <div className="model-settings-actions">
        <button className="button" onClick={save} type="button">
          {t("保存配置", "Save configuration")}
        </button>
        {status ? <span>{status}</span> : null}
      </div>
    </div>
  );
}

function ModelConfigBlock({
  apiKeyConfigured,
  fields,
  onChange,
  onValidate,
  locale,
  title,
  validating,
}: {
  apiKeyConfigured: boolean;
  fields: Array<{ label: string; name: FormFieldName; secret?: boolean; value: string }>;
  locale: Locale;
  onChange: (name: FormFieldName, value: string) => void;
  onValidate: () => void;
  title: string;
  validating: boolean;
}) {
  function t(zh: string, en: string) {
    return locale === "en" ? en : zh;
  }

  return (
    <div className="model-config-block">
      <div className="model-config-heading">
        <h3>{title}</h3>
        <span>{apiKeyConfigured ? t("密钥已保存", "Key saved") : t("密钥未保存", "Key not saved")}</span>
      </div>
      {fields.map((field) => (
        <label className="model-config-field" key={field.name}>
          <span>{field.label}</span>
          <input
            onChange={(event) => onChange(field.name, event.target.value)}
            placeholder={field.secret && apiKeyConfigured ? t("留空则保留已保存密钥", "Leave blank to keep saved key") : ""}
            type={field.secret ? "password" : "text"}
            value={field.value}
          />
        </label>
      ))}
      <button className="button button-secondary" disabled={validating} onClick={onValidate} type="button">
        {validating ? t("验证中...", "Validating...") : t("验证配置", "Validate")}
      </button>
    </div>
  );
}
