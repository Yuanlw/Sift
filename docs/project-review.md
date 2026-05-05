# Sift Project Review

Date: 2026-05-05

## Verdict

Sift is complete as a personal MVP.

The core loop now works end to end:

```text
Capture -> Process -> Source -> Wiki -> Review -> Ask -> Manage
```

It can be used daily by one person to collect real material, turn it into traceable sources and wiki pages, ask questions across the knowledge base, and manage long lists through search, archive, restore, and permanent delete.

It is not yet complete as a public hosted SaaS product. The remaining work is less about adding another capture feature and more about hardening reliability, permissions, model quality, evaluation, and deployment operations.

## What Is Working

### 1. Capture-first product shape

The product has a clear boundary: Sift is a capture-first LLM Wiki and knowledge layer, not a general agent runtime.

The strongest implemented flow is:

- save raw input quickly;
- process in the background;
- keep raw material even when extraction, OCR, model calls, or embeddings fail;
- let users retry, supplement, ignore, archive, restore, or delete later.

This matches the actual behavior needed for mobile capture and reduces the pressure to organize content at save time.

### 2. Inbox and mobile capture

The Inbox has moved from a traditional form to a Capture Composer. It supports links, text, images, mixed input, first-save notes, imports, date grouping, and triage views.

The current Inbox is usable as the daily capture and processing surface. It no longer tries to be the full knowledge review surface, which is the right product split.

### 3. Source and Wiki management

Sources and wiki pages now have:

- default, archived, and test-data views;
- search and filters;
- load-more behavior;
- detail pages;
- archive and restore;
- batch actions;
- permanent delete after archive;
- cleanup of search chunks and related records.

This is enough for the first wave of real data growth. The user is no longer trapped in endless lists with no management tools.

### 4. Knowledge reuse

Whole-knowledge-base Ask, wiki-page Ask, history, citations, source links, recommendations, and recent review are all present.

The product has crossed the important line from "stores information" to "helps the user reuse information."

### 5. Agent boundary

The Agent API and MCP endpoint are directionally correct. They expose Sift as a context and citation layer for external tools without turning Sift itself into a broad execution runtime.

## Main Risks

### P1 - Production auth is still foundational, not mature

The current user boundary supports single-user mode and trusted-header mode. This is fine for local or controlled internal deployment, but not enough for public multi-tenant SaaS.

Risk:

- a misconfigured reverse proxy could collapse multiple users into the default user;
- trusted headers must only be used behind a real authentication gateway;
- there is no complete account, session, organization, or invite model.

Recommendation:

- keep public hosted deployment out of scope until auth is redesigned;
- document that current deployment is personal or controlled internal use;
- treat SaaS auth as a separate phase, not a quick polish task.

### P1 - Background processing needs a durable production mode

Inline processing is excellent for local use because it keeps setup simple. For production, it is not enough by itself.

Risk:

- process restarts can interrupt queued work;
- retry policy is mostly user-driven and route-driven;
- operational visibility exists in jobs, but not as a complete worker dashboard.

Recommendation:

- make Inngest or another durable queue the production default;
- add a repair command for stuck queued/running jobs;
- add a small admin-only job monitor before broader deployment.

### P1 - Model quality is not yet measured

The model layer is configurable, but there is not yet a repeatable evaluation set.

Risk:

- wiki quality, OCR quality, extraction quality, and answer faithfulness may vary dramatically across models;
- recommendations and discoveries can feel random if the source summaries are weak;
- no automatic regression signal exists when prompts or models change.

Recommendation:

- P8 should start with a small curated evaluation set;
- measure extraction, OCR, wiki generation, retrieval, citation accuracy, and answer usefulness;
- choose default models based on results, not preference.

### P2 - Real merge is still missing

Sift can detect similar or duplicate sources and wiki pages, but it does not yet provide a trusted one-click merge workflow.

Risk:

- related captures still create separate pages;
- the knowledge base may fragment as data grows;
- users see suggestions but still need manual cleanup.

Recommendation:

- add "merge into existing wiki page" as the next high-value product action;
- keep merge reversible at first;
- show exactly which sources support the merged page.

### P2 - Permanent delete is safe enough for MVP, but needs a clearer product policy

Permanent delete now requires archive first and clears related search chunks. That prevents most accidental and ghost-search issues.

Remaining policy question:

- when deleting a source that created a wiki page, should the orphan wiki page remain, be archived, or be deleted if no sources remain?

Recommendation:

- keep the current conservative behavior for now;
- add an "orphan wiki page" indicator later;
- offer "delete source only" and "delete source plus generated wiki page" as separate actions if users need it.

### P2 - Search is useful, but not yet a full research interface

Management search now combines full-text search, semantic recall, and fallback matching. It is good enough for long-list management.

Remaining gaps:

- no advanced search syntax;
- no saved searches;
- no topic clusters;
- no faceted filters beyond the first source type filter;
- semantic recall depends on embedding availability and current chunk quality.

Recommendation:

- do not overbuild search yet;
- add topic grouping after merge becomes available;
- keep the current search as the management baseline.

### P2 - Import is useful, but true capture surface is still incomplete

Batch URL import, bookmark HTML import, and photo import are present. However, browser extension, iOS Shortcut, Android share, and semi-automated WeChat/X flows are still missing.

Risk:

- users still need to remember to open Sift;
- phone-first capture is good inside Sift, but not yet deeply embedded into the phone/browser operating flow.

Recommendation:

- prioritize iOS Shortcut or bookmarklet before a full browser extension;
- keep platform-specific scraping conservative;
- preserve raw links, screenshots, and user text as the reliable fallback.

### P3 - Tests are lighter than the feature surface

Typecheck, lint, build, and targeted smoke checks pass. This is enough while iterating quickly, but not enough for ongoing confidence.

Risk:

- triage, deletion, import, retry, and ask-history behavior can regress quietly;
- database migrations are manually applied and not verified in a unified test run.

Recommendation:

- add route-level smoke tests for capture, retry, supplement, ignore, archive, restore, delete, import, Ask, and MCP;
- add a small seeded database fixture for repeatable review;
- keep visual/mobile checks for Inbox and management lists.

## Product Completeness

### Complete for personal MVP

- Fast capture.
- Async processing.
- Source and wiki generation.
- Retry and supplement.
- Recent review.
- Ask and history.
- Long-list management.
- Archive, restore, and permanent delete.
- Agent context access.

### Not complete for public SaaS

- Real multi-tenant authentication.
- Organization/user management.
- Billing and plan boundaries.
- Production queue and worker operations.
- Abuse prevention and rate limits.
- Legal/privacy documentation.
- Model evaluation and default model recommendation.
- Hosted-service license/commercial terms.

## Recommended Next Phases

### Phase A - Hardening before more features

1. Add route-level regression smoke tests.
2. Add a job repair/admin view.
3. Add orphan source/wiki indicators.
4. Tighten docs around deployment modes and auth expectations.

### Phase B - P8 model provider and evaluation

1. Build a small evaluation dataset.
2. Score extraction, OCR, wiki generation, retrieval, citations, and answers.
3. Add provider adapters only where evaluation justifies it.
4. Separate text, embedding, and vision model recommendations.

### Phase C - Knowledge consolidation

1. Add one-click merge to wiki page.
2. Support reversible merge history.
3. Group discoveries by topic.
4. Build weekly or recent topic review from merged sources.

### Phase D - Capture surfaces

1. Bookmarklet or browser shortcut.
2. iOS Shortcut.
3. Android share target.
4. Later: browser extension.

## Final Assessment

Sift has reached the right kind of MVP completeness: not every possible feature is done, but the core product loop is real.

The project should now avoid drifting into broad agent execution. The next work should make the existing loop more reliable, measurable, and easy to use every day.
