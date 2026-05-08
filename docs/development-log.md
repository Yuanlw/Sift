# Development Log

This log records implementation checkpoints that matter for future continuation. It is not a full commit history; it captures product decisions, risk fixes, and verification commands.

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
