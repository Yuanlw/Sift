# Development Log

This log records implementation checkpoints that matter for future continuation. It is not a full commit history; it captures product decisions, risk fixes, and verification commands.

## 2026-05-10 Delete Semantics And Test View Removal

### Context

The previous "test captures" / `low-signal` view was keyword-based. It treated titles or text containing `Pxx`, `SMOKE`, `TEST`, `REVIEW`, or `REGRESSION` as low-signal test data, which is not safe for real users because normal material can match those words.

### Changes

- Removed the test-data/low-signal view from Inbox, Sources, and Wiki.
- Historical items that used to appear under test data now appear as normal active material unless explicitly archived or deleted.
- Source and Wiki detail pages now show permanent delete directly, not only after archive.
- Source and Wiki list bulk actions now allow direct permanent delete from active and archived views.
- Permanent delete now cascades through the knowledge objects it owns: Capture, Source, Wiki, chunks, graph edges, scoped ask histories, and join rows through database cascades.
- Cascade delete avoids deleting shared objects when another Source or Wiki still owns the relationship.

### Verification

```bash
npm run typecheck
npm run lint
git diff --check
```

## 2026-05-10 Image OCR Visibility Acceptance

### Context

Image OCR text was being persisted to `extracted_contents` and `sources.extracted_text`, and `source_wiki_pages` links were present. The confusing part was product visibility: Wiki pages are model-organized drafts, so the model could summarize OCR text and omit the full original image text. Source lists also showed only summary, which made image sources look empty unless the user opened the detail page.

### Changes

- Added `src/lib/wiki-content.ts` to guarantee image captures preserve OCR text in Wiki markdown when the model draft does not already include it.
- Source list rows now fall back to extracted text preview when no summary is available.
- Source list Wiki relation preview now ignores archived Wiki pages.
- Product acceptance now includes an image OCR visibility case covering Source text, Source list preview, Wiki OCR raw text, and Source/Wiki linkage.

### Verification

```bash
npm run typecheck
npm run lint
npm run acceptance:product
git diff --check
```

## 2026-05-08 Review Fixes And Service Restart

### Context

After a broad review of the recent Sift development work, four concrete issues were fixed:

1. Smoke auth could bypass first-account default-data claiming.
2. Wiki merge preview used a non-existent `source_wiki_pages.updated_at` column.
3. Many signed-in browser write APIs did not share the same Origin / Referer protection.
4. Knowledge discovery list joins did not constrain joined Source / Wiki rows by `user_id`.

### Changes

Smoke auth:

- `scripts/smoke-agent-api.mjs` no longer directly provisions a smoke user when the database has zero users.
- In a zero-account database, smoke falls through to `/api/auth/signup`, preserving the first-account claim path in `registerUser`.
- When the database already has users, smoke may provision the default `local@sift.dev` user for local verification.
- Smoke provision now clears both email and default `unknown` IP login rate-limit keys.

Wiki merge:

- `src/lib/knowledge-merge.ts` now orders related source wiki candidates by `rsswp.created_at`, matching the actual `source_wiki_pages` schema.
- The local database was checked with `select rsswp.created_at from source_wiki_pages rsswp limit 1;`.

Same-origin protection:

- Browser login-session write APIs now call `validateSameOriginRequest`.
- Covered areas include capture create/import/supplement/retry/ignore, Ask, Wiki Ask, discovery actions, recommendations, source/wiki archive/delete/bulk actions, model settings, billing checkout/portal, and logout.
- External integration routes were intentionally left on their own auth paths: Agent API, MCP, Inngest, Stripe webhook, and maintenance recovery.

User-scoped discovery joins:

- `src/lib/knowledge-discoveries.ts` now joins `sources` and `wiki_pages` with `and ...user_id = kd.user_id`.
- This avoids leaking titles or slugs if bad data or a future script creates cross-user references.

### Verification

The repair pass was verified with:

```bash
npm run typecheck
npm run lint
npm run build
npm run smoke:agent
```

The local service was restarted afterward and confirmed on port `3000`:

```text
http://127.0.0.1:3000
```

The homepage returned the expected authenticated redirect:

```text
307 -> /login?next=%2F
```

### Notes For Future Work

- Do not run `npm run build` concurrently with a dev server or another process writing `.next`; it can produce noisy `PageNotFoundError` failures during page-data collection.
- `npm run smoke:agent` depends on a running Sift server and local database access.
- The smoke script is a verification helper, not a data migration tool. Keep first-account data claiming inside app auth flow or a dedicated migration script.
- A future post-launch idea is a very light note mode: short inputs can be saved as searchable records without analysis, and later shown in a calendar-like day grid. Keep that as a follow-on capture UX concept, not a current launch blocker.

## 2026-05-08 Documentation Refresh

### Reason

The codebase now includes account/session basics, model settings, quota and billing foundations, graph-aware retrieval, knowledge merge, processing recovery, and security hardening. The docs needed to reflect this broader surface.

### Updated Documents

- `README.md`: current status now includes P10/P11 relationships and P12 merge.
- `docs/capture-first-roadmap.md`: added completion notes for P10/P11, P12, and P9.4 security fixes.
- `docs/data-model.md`: documented `KnowledgeEdge`, `KnowledgeDiscovery`, and `WikiMergeHistory`.
- `docs/agent-api.md`: updated auth, graph metadata, and smoke behavior.
- `docs/local-setup.md`: documented same-origin protection and smoke account behavior.
- `docs/deployment.md`: clarified Docker migration vs reset, public SaaS auth caveat, trusted-header deployment rules, and Agent user binding.
- `docs/project-review.md`: added 2026-05-08 review update and current risk list.

### Current Engineering Baseline

The reliable validation sequence for this phase is:

```bash
npm run typecheck
npm run lint
npm run build
npm run smoke:agent
```

For smoke, start the service first:

```bash
npm run dev
```

or run against another base URL:

```bash
SIFT_BASE_URL=http://127.0.0.1:3001 npm run smoke:agent
```

## 2026-05-09 P22 Deployment Readiness

### Reason

P18-P21 have already moved Sift from local product hardening into trial-readiness work: retention signals, mobile capture entry, account and billing gates, support/refund operations, and model quota boundaries. Before real deployment, P22 turns these into an explicit release gate instead of relying on memory or ad hoc checks.

### Updated Documents And Scripts

- Added `docs/deployment-readiness.md` as the deployment-prep checklist.
- Added `npm run verify:release`, which runs `typecheck`, `lint`, `build`, `preflight:trial`, and `acceptance:product`.
- Updated `docs/capture-first-roadmap.md` with P22 status and next deployment direction.
- Updated `docs/deployment.md` to point operators at the readiness checklist and keep Docker migration as the default path.
- Updated `docs/real-user-trial-checklist.md` so real-user trial checks depend on release readiness first.
- Improved `scripts/preflight-real-user.mjs --db` error output so failed DB checks expose safe diagnostics without printing connection strings.

### Verification

Completed successfully:

```bash
git diff --check
SIFT_SESSION_SECRET=local-preflight-secret-1234567890abcdef SIFT_REQUIRE_AUTH=true SIFT_ADMIN_EMAILS=ops@example.com npm run verify:release
```

The release verification emitted only offline/payment-environment warnings for missing cloud control and Stripe secrets. Those are expected for local preflight and must be provided before paid public deployment.

Built runtime route checks were also run against `next start -p 3002`:

```text
/capture?source=ios_shortcut&title=T&url=https%3A%2F%2Fexample.com -> 307 /login?next=...
/admin/retention -> 307 /login?next=...
/admin/refunds -> 307 /login?next=...
/admin/account-support -> 307 /login?next=...
```

This confirms the public capture URL preserves its parameters through auth and admin pages remain behind login.

### Remaining Deployment-Environment Checks

These are not code failures, but they still need to pass in the actual deployment environment:

- `node scripts/preflight-real-user.mjs --db` failed locally with `ECONNREFUSED` because Postgres was not reachable.
- Local Docker was not available, so Docker-backed DB verification could not be completed in this workspace session.
- `npm run smoke:agent` still needs to be rerun after the deployment database, built server, and model or gateway endpoint are reachable.

### Deployment Direction

The recommended first deployment path remains VPS + Docker Compose + Cloudflare. It gives the project the least moving parts while preserving control over Postgres, uploads, migrations, background jobs, and model gateway configuration. Vercel + managed Postgres + Inngest can be reconsidered after the first real-user trial proves retention.

## 2026-05-09 Runtime Deployment-Preflight Review

### Reason

The earlier P22 review had only partial runtime coverage because the local database and model services were not fully available. This pass reran the review with Docker Postgres healthy, the app running on `localhost:3000`, and model-backed processing/Ask paths exercised.

### Fixes From This Pass

- Added local auth trial variables to `.env.local`: `SIFT_REQUIRE_AUTH`, `SIFT_SESSION_SECRET`, `SIFT_ALLOW_PUBLIC_SIGNUP`, and `SIFT_ADMIN_EMAILS`.
- Fixed `/admin/retention` event ordering SQL by sorting on `count(*)` instead of the `events` alias.
- Reworked `/admin/retention` summary/funnel queries to aggregate per table before joining, avoiding row multiplication. Local response time dropped from roughly 37 seconds to roughly 0.3 seconds.

### Runtime Verification

Completed successfully:

```bash
npm run typecheck
npm run lint
npm run build
npm run preflight:trial
node scripts/preflight-real-user.mjs --db
SIFT_BASE_URL=http://localhost:3000 SIFT_SMOKE_EMAIL=local@sift.dev SIFT_SMOKE_PASSWORD=... npm run smoke:agent
git diff --check
```

Manual HTTP checks also passed:

- Login, session persistence, closed public signup, and unauthenticated admin redirect.
- User pages: `/`, `/capture`, `/inbox`, `/sources`, `/wiki`, `/settings`.
- Capture create -> processing job -> Source -> Wiki -> product events.
- Detail pages for the generated Inbox, Source, and Wiki records.
- Global Ask and Wiki Ask with model-backed answers and citations.
- Admin pages: `/admin/retention`, `/admin/account-support`, `/admin/refunds`.
- Admin writes: support note create, manual refund create, checklist update, and mark paid.
- Gateway token list, issue, and revoke.
- Public pages: pricing, refund, contact, privacy, and terms.

### Remaining Deployment Notes

- Stripe checkout and portal correctly return `503` until Stripe secrets are configured.
- Cloud control API is still optional for the current local trial, but required before operating Sift Gateway as a hosted paid service.
- Local browser testing should use `http://localhost:3000`; mixing `127.0.0.1` and `localhost` can trip same-origin checks and cookie behavior.
