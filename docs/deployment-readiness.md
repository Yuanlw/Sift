# Deployment Readiness Checklist

P22 is the deployment-prep checkpoint. It does not add product scope; it makes sure the current work can be submitted, migrated, started, and validated before choosing a deployment target.

## Required Before Deployment Discussion

- `git diff --check`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run preflight:trial`
- `npm run acceptance:product` against a built or dev server on `SIFT_BASE_URL` / `http://localhost:3000`
- `node scripts/preflight-real-user.mjs --db` when the target Postgres is reachable
- `npm run smoke:agent` against a built server when model services and Postgres are reachable

The product acceptance gate creates temporary fixture data, verifies list dedupe, archive visibility, Agent resource visibility, and permanent delete cascade semantics, then cleans its own rows. It requires Postgres and the app server to be reachable.

The `--db`, `acceptance:product`, and `smoke:agent` checks are environment checks. If they fail because Postgres, the built server, or the model endpoint is not running, fix the environment or record the blocker before deployment.

The combined release gate is:

```bash
npm run verify:release
```

## Migration Gate

Existing deployments must use migrations, not resets:

```bash
npm run docker:migrate
```

For non-Docker Postgres, run the SQL files under `supabase/migrations/` in order with `ON_ERROR_STOP=1`.

Do not use `docker:reset` outside disposable local data. Reset deletes the named Postgres volume.

## Environment Gate

Minimum controlled trial deployment:

- `DATABASE_URL`
- `SIFT_SESSION_SECRET`
- `SIFT_REQUIRE_AUTH=true`
- `SIFT_ALLOW_PUBLIC_SIGNUP=false` unless intentionally opening signups
- `SIFT_TRUST_USER_HEADER=false` unless an upstream gateway owns auth
- `SIFT_ADMIN_EMAILS`
- model configuration through either local/BYOK env or `SIFT_MODEL_GATEWAY_BASE_URL` plus `SIFT_MODEL_GATEWAY_API_KEY`

If this deployment also acts as the Sift Cloud control plane for Gateway validation, configure:

- `SIFT_CLOUD_CONTROL_API_KEY`

If it is taking public payment, configure:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- plan price ids

## Runtime Gate

After starting the built app, confirm:

- `/capture` redirects unauthenticated users to `/login?next=...` and preserves shared parameters.
- `/admin/retention`, `/admin/account-support`, and `/admin/refunds` are inaccessible without admin login.
- Settings loads for a signed-in user and shows account, quota, model channel, and Gateway authorization status.
- A capture can be saved without waiting for extraction, OCR, summaries, embeddings, or Ask.
- Processing jobs can complete or fail visibly without losing raw capture data.

## Deployment Choice For Next Step

For the next real-user trial, prefer:

- one VPS;
- Docker Compose;
- Postgres with pgvector in the same compose stack;
- Cloudflare for DNS/SSL/CDN;
- `JOB_DISPATCHER=inline` while the process is long-lived.

Vercel + Neon + Inngest is a later path when the product is ready for public SaaS or when the VPS is no longer enough.
