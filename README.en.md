# Sift

[中文](README.md)

Sift is a capture-first personal knowledge base.

It helps you save scattered links, text, screenshots, notes, and imported bookmarks, then turns them into traceable sources, readable wiki pages, and reusable context for search, Q&A, writing, research, and later agent workflows.

> Sift turns what you see, think, and save every day into knowledge assets you can actually reuse later.

## Why Sift Exists

Most people do not lack ways to collect information. They lack a reliable way to reuse it.

Typical information workflows break in the middle:

1. You see something useful in a browser, chat, social feed, newsletter, PDF, or screenshot.
2. You save it to bookmarks, notes, albums, read-later tools, or a private chat.
3. Weeks later it is hard to find, hard to trust, and hard to turn into writing, decisions, or action.

Sift closes that loop:

```text
Capture -> Process -> Source -> Wiki -> Search / Ask / Review
```

The product is built around one principle:

> Saving must be fast. Understanding can happen in the background.

## What It Does

Sift currently supports a complete MVP loop:

- Fast capture for links, text, screenshots, and notes.
- Mixed captures, such as a URL plus copied text plus images plus a reason for saving.
- Inbox grouped by time, with today, active, failed, needs-note, ignored, and test-data views.
- Background processing into extracted content, sources, wiki pages, chunks, and embeddings.
- Failure handling with supplement, retry, ignore, archive, restore, and permanent delete flows.
- Batch URL import, browser bookmark HTML import, and photo batch import.
- Recent review, knowledge discoveries, duplicate hints, and persistent recommendations.
- Whole-knowledge-base Ask and per-wiki-page Ask, with history.
- Source and wiki management with filters, full-text search, semantic recall, load-more, archive, restore, and permanent delete.
- Agent-facing API and MCP endpoint for external tools that need Sift context.

## Product Boundary

Sift is not a general-purpose agent runtime.

It does not try to replace tools such as Claude Code, Codex, pi-mono, workflow agents, or automation platforms. Sift focuses on the long-term knowledge layer:

- Capture what the user sees, reads, saves, and thinks.
- Preserve original material and traceable sources.
- Organize knowledge into reusable pages and context chunks.
- Help external agents retrieve trustworthy user-owned context.

Complex execution should stay in dedicated agent workbenches. Sift supplies memory, sources, citations, and knowledge structure.

## Current Status

Sift is now a usable personal MVP:

- P0-P4: capture-first foundation, extraction, source/wiki generation, search, Ask, Agent API, MCP.
- P5/P5.5: mobile-first capture composer, daily inbox triage, retry/supplement/ignore, notes.
- P6: external collection import, including URLs, bookmarks, and photo batches.
- P7: recent review, knowledge discoveries, recommendations, long-list management, archive/restore/delete, management search.
- P8: model-call metering, model strategy documentation, an account/model/usage settings center, and smart-quota ledger.

The project is ready for personal daily testing and focused product review.

It is not yet a polished hosted SaaS product. Before wider public deployment, the main remaining work is stronger auth, production task queues, model provider adapters, evaluation sets, full regression testing, and a cleaner account/deployment story.

See [Project Review](docs/project-review.md) for the current completeness assessment.

## Quick Start

For local development with Docker Postgres:

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:migrate
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm run build
```

For Docker Compose deployment and migration notes, see [Deployment](docs/deployment.md).

## Model Setup

Sift model setup now belongs in `/settings`, not in `.env` for regular users.

There are two modes:

- Use Sift default models: show capabilities, quota, usage, and health only. Provider, model names, endpoints, and keys are not shown.
- Use custom models: configure OpenAI-compatible text, embedding, and vision/OCR models, with validation buttons in the UI.

At a high level, you need:

- A chat/text model for extraction, structuring, wiki generation, and answers.
- An embedding model for retrieval.
- Optionally, a vision model for image OCR.

Model-related `.env` values should be treated as deployment defaults or future hosted-SaaS defaults. For normal users, model choice and keys should be managed in the settings center.

Custom model API keys are never returned to the client. SaaS or multi-user deployments should set `SIFT_MODEL_KEY_ENCRYPTION_SECRET`; newly saved custom model keys are encrypted server-side before being stored. Local single-user deployments may leave it empty to keep setup simple.

Default models use one unified smart quota. Users see monthly quota, used credits, remaining credits, and where usage went; internally Sift accounts by material processing, image OCR, semantic indexing, Ask, and retrieval. Custom model mode does not consume Sift smart quota.

SaaS billing uses Stripe Checkout. Hosted deployments need Stripe subscription Prices plus `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PERSONAL`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`, and `SIFT_APP_URL`. Local single-tenant deployments can leave them empty.

Before submitting the site for Stripe review, prepare the public website properly: HTTPS domain, real contact email, truthful and consistent business information, Pricing, Contact Us, Privacy Policy, Terms of Service, and Refund Policy. Sift includes these public pages; hosted deployments should replace placeholders with `SIFT_CONTACT_EMAIL`, `SIFT_BUSINESS_NAME`, `SIFT_BUSINESS_ADDRESS`, and `SIFT_PRICE_LABEL_*`.

The project is designed so the model layer can evolve without changing the product boundary. Future provider work should support OpenAI, Anthropic, Google Gemini, Qwen, DeepSeek, Doubao, Zhipu, Kimi, local model gateways, and custom OpenAI-compatible services.

## Main Screens

- `/` - home, recent review, recommendations, whole-knowledge-base Ask.
- `/inbox` - fast capture, imports, daily triage, failed/active/ignored views.
- `/sources` - cleaned source material with search, filters, archive, restore, and delete.
- `/wiki` - generated knowledge pages with search, filters, archive, restore, delete, and page-level Ask.
- `/settings` - settings center for account/deployment info, model configuration, model usage, and billing boundaries.

## Documentation

- [Project Review](docs/project-review.md)
- [Model Strategy and Billing](docs/model-strategy-and-billing.md)
- [Capture-first Roadmap](docs/capture-first-roadmap.md)
- [Mobile-first Capture Roadmap](docs/mobile-capture-roadmap.md)
- [Local Setup](docs/local-setup.md)
- [Deployment](docs/deployment.md)
- [Agent API / MCP](docs/agent-api.md)
- [Product Brief](docs/product-brief.md)
- [MVP Scope](docs/mvp.md)
- [Architecture](docs/architecture.md)
- [Data Model](docs/data-model.md)

## License

Sift is source-available, not open source.

You may use, study, modify, and run this project for personal, educational, research, evaluation, and internal organizational use, subject to the license terms.

You may not offer Sift, a modified Sift, or a substantially similar hosted derivative as a public SaaS, managed service, paid hosted product, white-label product, or resale offering without explicit written permission.

See [LICENSE](LICENSE) for the full terms. For commercial licensing or hosted-service permission, contact the project owner.
