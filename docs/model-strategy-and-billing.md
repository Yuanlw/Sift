# Model Strategy and Billing

Date: 2026-05-05

## Core Decision

P8 should not start by adding many provider adapters.

It should start by separating model roles, measuring model usage, and defining how BYOK and default hosted models affect billing.

Sift has two large model surfaces:

1. Capture processing.
2. Knowledge reuse and Q&A.

They use similar model types, but they should be measured separately because their quality, cost, and user expectations are different.

## Model Roles

### 1. Capture processing models

These models run after a user saves material.

They should never block the initial save action.

Roles:

- OCR model: reads screenshots and images.
- Text model: structures extracted material into source summaries and wiki pages.
- Embedding model: writes searchable chunks for later retrieval.

Typical purposes:

- `capture.ocr`
- `capture.structure`
- `capture.create_embeddings`

Product expectation:

- If OCR fails, keep the image.
- If structuring fails, keep extracted text and fallback wiki content.
- If embedding fails, source and wiki should still appear.
- User can supplement, retry, ignore, archive, restore, or delete later.

### 2. Knowledge reuse and Q&A models

These models run when the user actively searches, asks, or asks an external Agent to fetch context.

Roles:

- Embedding model: retrieves relevant chunks for all-library Ask, semantic search, and Agent context.
- Text model: answers questions based on retrieved snippets or a specific wiki page.

Typical purposes:

- `ask.global.embedding`
- `ask.global.answer`
- `ask.wiki.answer`
- `management.sources.embedding`
- `management.wiki.embedding`
- `agent.query.embedding`

Product expectation:

- Answers must be grounded in retrieved Source/Wiki context.
- Ask history can be used as intent memory, not as factual evidence.
- If retrieval fails, return a useful "not enough material" response instead of hallucinating.

## Usage Logging

P8.0 adds model call logs.

The log should record:

- user id;
- stage: processing, ask, retrieval, management, or agent;
- role: text, embedding, or vision;
- purpose;
- provider;
- model;
- endpoint host;
- success or failure;
- duration;
- request count;
- input/output character counts;
- provider token usage when available;
- related resource id when available;
- error message when failed.

The log must not store raw prompt text, raw source text, image content, or model output.

This gives Sift enough data for:

- model quality review;
- cost estimation;
- quota and billing design;
- debugging slow or failing model calls;
- comparing BYOK and hosted-default usage.

## User Configuration vs Default Hosted Models

Sift should support two business modes.

### Custom model mode

The user provides their own model keys or local model gateway in the Sift settings UI.

Examples:

- local OpenAI-compatible gateway;
- user-owned OpenAI, DeepSeek, Qwen, Kimi, Gemini, or Anthropic account;
- company model gateway;
- local MLX/vLLM/Ollama/LM Studio service.

Billing implication:

- Sift should not charge for model tokens.
- Sift may charge for the software, hosting, sync, storage, support, or team features.
- Usage logs are still useful for user visibility and debugging.
- Custom mode must not silently fall back to Sift default models when a field is missing. It should ask the user to complete configuration or switch back to default mode.
- `/settings` should never return saved API keys to the browser.
- SaaS or multi-user deployments should set `SIFT_MODEL_KEY_ENCRYPTION_SECRET`; newly saved custom model API keys are encrypted before storage.
- Existing plaintext custom keys remain readable for local compatibility and should be re-saved after enabling encryption in hosted deployments.

### Default hosted model mode

The user uses model capacity provided by Sift.

Product implication:

- The UI should show capabilities, quota, usage, and health status.
- It should not show the underlying provider, model name, endpoint, or API keys to regular users.
- Deployment `.env` values are allowed as SaaS/default-model infrastructure configuration, but normal users should configure models in the settings UI.

Billing implication:

- Sift must charge for model usage or include it inside a plan quota.
- OCR, structuring, embeddings, and Ask should have separate metering internally.
- Heavy import users and heavy Ask users have different cost profiles.

Possible product packaging:

- Free/local: BYOK only, local or self-hosted.
- Personal: included monthly model credits, extra usage paid or throttled.
- Pro: higher model credits, faster processing, better default models.
- Team: shared workspace, admin controls, higher limits, audit and support.
- Enterprise/self-hosted: BYOK or private model gateway, custom commercial terms.

## Charging Principles

Do not charge users for "number of saved items" alone.

The real cost drivers are:

- OCR images processed;
- text model input/output tokens;
- embedding tokens/chunks;
- repeated Ask and retrieval calls;
- imports that trigger large background processing.

Recommended billing language:

```text
Sift can run with your own custom model configuration, where model cost is paid directly by you to your model provider.
If you use Sift's default models, model usage is metered and may count against included credits or plan quota.
```

## P8.2 Smart Quota Design

The product should expose one user-facing quota, not three separate model bills.

User-facing model:

- Sift default models consume one unified "smart quota".
- Custom model mode does not consume Sift smart quota.
- Users should not need to understand text models, embedding models, OCR models, or provider subscriptions.
- The settings page should explain usage by capability: material processing, image OCR, semantic indexing, Ask, and agent/context retrieval.

Internal accounting model:

- OCR, text calls, embeddings, Ask, management search, and Agent retrieval are still recorded separately.
- Each successful default-model call writes a quota ledger row.
- The ledger stores stage, role, purpose, resource id, model-call id, category, credits, and calculation metadata.
- Raw prompts, source text, image content, and model outputs are never stored in quota ledger rows.

Single-tenant behavior:

- Default account mode is `unlimited`.
- Sift still records smart-quota usage for visibility and runaway-cost diagnosis.
- Operators can switch a user to `soft_limit` or `hard_limit` in the database if they want local guardrails.
- Save actions must remain fast and available. If smart processing is limited, raw captures should still be preserved.

SaaS behavior:

- Plans should set monthly quota and enforcement mode per user or workspace.
- Subscription checkout should use Stripe Checkout rather than a custom payment form.
- Stripe webhooks should be the source of truth for activating paid plan quota.
- `soft_limit` warns but keeps processing.
- `hard_limit` blocks new default-model calls when the monthly quota is exhausted.
- Over-quota captures can remain saved and wait for quota refresh, add-on credits, plan upgrade, or custom model mode.
- Team and enterprise plans can share quota at workspace level later; P8.2 starts with user-level quota.

Recommended categories:

- `capture_processing`: text structuring and wiki generation.
- `image_ocr`: screenshot and photo text recognition.
- `semantic_indexing`: embedding writes and semantic indexing.
- `ask`: all-library and page-level question answering.
- `retrieval`: semantic search, management search, Agent context retrieval.

Recommended first scoring rule:

- Text calls: derive credits from provider tokens when available, otherwise input/output character scale.
- Embeddings: derive credits from input character scale.
- Vision OCR: derive credits mostly from image count and request count.
- The formula should be simple, visible internally, and adjustable later without changing the user-facing concept.

### Stripe Integration

P8.3 uses Stripe only for SaaS billing.

Required Stripe setup:

- Create a Stripe account and complete business verification when Stripe requires it. Identity, bank, business address, and public website information must be true, stable, and consistent.
- Create recurring subscription Products/Prices for Personal, Pro, and Team.
- Copy the Price IDs into `STRIPE_PRICE_PERSONAL`, `STRIPE_PRICE_PRO`, and `STRIPE_PRICE_TEAM`.
- Create a restricted or standard secret key for the SaaS backend and set `STRIPE_SECRET_KEY`.
- Add a webhook endpoint pointing to `/api/billing/stripe/webhook`.
- Listen for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
- Set `SIFT_APP_URL` to the public SaaS origin so Checkout can return to `/settings`.
- Enable Stripe Customer Portal in the Stripe Dashboard so `/api/billing/portal` can create self-service billing sessions.
- Set `SIFT_CONTACT_EMAIL`, `SIFT_BUSINESS_NAME`, and `SIFT_BUSINESS_ADDRESS` for the public website contact pages.
- Set `SIFT_PRICE_LABEL_PERSONAL`, `SIFT_PRICE_LABEL_PRO`, and `SIFT_PRICE_LABEL_TEAM` so the public pricing page shows clear prices that match Stripe Checkout.

Public website readiness before Stripe review:

- Use a public HTTPS domain with a real product homepage, not a half-built local/demo page.
- Use a domain email or other stable business email. Avoid disposable or unrelated personal mailboxes for production.
- Keep footer links visible for Pricing, Contact Us, Privacy Policy, Terms of Service, and Refund Policy.
- Show clear subscription plan information and a path to subscribe.
- Show public price labels before review; do not rely only on hidden Stripe Price IDs.
- Keep refund, privacy, and terms pages consistent with the actual billing model: Sift default models consume smart quota; custom models are paid directly by the user to their chosen provider.
- Do not use fake identity, bank, or address information. Stripe verification and payment disputes depend on this information being truthful and consistent.

Product behavior:

- The settings page creates a Stripe Checkout Session for the selected plan.
- The settings page creates a Stripe Billing Portal Session for existing Stripe customers, so invoices, payment methods, cancellation, and plan changes stay in Stripe.
- Checkout metadata includes `user_id`, `plan_code`, and monthly credits.
- Webhook completion updates `smart_quota_accounts` with `quota_source = stripe`, `hard_limit`, the selected plan code, monthly quota, customer id, subscription id, and subscription status.
- Subscription cancellation or unpaid terminal states downgrade the user to a small free hard-limit quota.
- Local single-tenant deployments can leave all Stripe variables empty.
- The settings page should behave like an account center rather than a raw technical config page: left navigation, usage statistics, API key status, pricing, order/invoice guidance, documentation/FAQ, and contact support should be easy to find.

## Evaluation Before Provider Expansion

Before adding many provider adapters, P8 should establish a small evaluation set.

Evaluation dimensions:

- extraction fidelity;
- OCR accuracy;
- wiki title quality;
- summary usefulness;
- structure and readability;
- citation faithfulness;
- retrieval relevance;
- answer groundedness;
- latency and failure rate;
- estimated cost by purpose.

Provider expansion should then be guided by results, not by a long model list.

## Current P8.0 Implementation

Implemented foundation:

- `model_call_logs` table and migration.
- `user_model_settings` table and migration.
- `smart_quota_accounts` and `smart_quota_ledger` tables and migration.
- Model call logging for capture structuring, capture embeddings, OCR, all-library Ask embedding, all-library answer, wiki answer, management semantic search, and Agent query retrieval.
- Logs store metadata and usage signals, not raw prompts or raw model outputs.
- `/settings` supports Sift default mode and custom OpenAI-compatible model mode.
- Custom text, embedding, and vision/OCR configuration can be saved and validated from the UI.
- API keys are never returned to the client; blank key fields preserve previously saved keys; hosted deployments can encrypt newly saved custom keys with `SIFT_MODEL_KEY_ENCRYPTION_SECRET`.
- Default mode hides provider, model name, endpoint, and key details from the UI.
- Default-model successful calls write smart-quota ledger rows.
- Custom model mode does not consume Sift smart quota.
- `/settings` shows monthly smart quota, used credits, remaining credits, enforcement mode, plan code, and category breakdown.
- Stripe Checkout endpoint for SaaS plan upgrades.
- Stripe webhook endpoint for subscription activation, updates, and cancellation downgrade.
- Stripe Billing Portal endpoint and settings-page entry for existing customers.

Deferred before public SaaS launch:

- map `customer.subscription.updated` from Stripe subscription item price IDs instead of only relying on subscription metadata;
- replace single-user/trusted-header identity with real hosted account sessions before enabling public billing;
- configure real public prices, contact information, business identity, and Stripe review materials;
- workspace-level shared quota for team plans;
- provider adapters beyond OpenAI-compatible.

Evaluation datasets and model comparison reports are useful internal tools, but they are not part of the current product-critical P8 path.
