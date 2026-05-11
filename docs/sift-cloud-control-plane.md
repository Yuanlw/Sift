# Sift Cloud Control Plane

Sift needs a small backend service before personal subscriptions can be sold cleanly.

This service should not replace the local-first Sift app. Its job is to manage subscription authorization and default model capacity. The local app should continue to own captures, sources, wiki pages, local files, user model settings, and local retrieval.

## Why It Exists

Personal users should not manage model provider API keys. A subscribed user should receive a Sift Gateway authorization token, while Sift keeps provider keys, routing, quota enforcement, and abuse controls on the backend side.

Without this control plane, Sift can show pricing, but it cannot safely answer:

- who is allowed to use Sift Gateway;
- which plan and quota apply;
- which token should be revoked after cancellation or suspected leakage;
- how model costs are guarded before they become a billing surprise;
- how support can diagnose a subscriber who says the local app stopped processing.

## First-Version Scope

P15 should build the minimum commercial control plane:

- Account: email identity for subscription ownership.
- Subscription: Stripe customer, subscription id, plan, status, renewal boundary.
- Gateway token: issue, list, rotate, revoke, and bind to account plus optional install id.
- Entitlement: monthly smart quota and plan capabilities exposed to the gateway.
- Gateway enforcement: reject revoked, expired, over-quota, or unpaid tokens before provider calls.
- Admin/support view: search account, inspect token status, subscription state, recent gateway failures, and quota usage.

The first version can be operationally simple. Token issuance and admin actions may start as internal tools if the user-facing account center is not ready.

## Implemented Skeleton

The first control-plane skeleton lives in the current Next.js app so it can later be extracted into Sift Cloud without changing the product boundary.

Tables:

- `sift_gateway_tokens`: stores token hash, visible prefix, status, plan snapshot, optional install id, expiry, last use, and revocation metadata.
- `sift_gateway_usage_ledger`: reserved gateway-side ledger for model capacity usage, rejection, and failure accounting.

APIs:

- `GET /api/gateway/tokens`: list the signed-in account's gateway tokens. Requires normal Sift session auth.
- `POST /api/gateway/tokens`: issue a gateway token for the signed-in account. The raw token is returned once; only a hash is stored.
- `POST /api/gateway/tokens/:id/revoke`: revoke one signed-in account token.
- `POST /api/gateway/tokens/validate`: server-to-server endpoint for Sift Gateway. Requires `Authorization: Bearer $SIFT_CLOUD_CONTROL_API_KEY`; validates token status, expiry, subscription/quota state, revocation, rate limits, and reserves estimated credits before a provider call.
- `POST /api/gateway/usage`: settles a reserved gateway authorization as `success` or `failure` after the model gateway knows the actual result.

Abuse controls:

- Local clients are not trusted to enforce quota.
- Gateway validation records rejected requests for active tokens, so repeated revoked/expired/over-quota attempts are visible.
- Successful validation creates a `reserved` ledger row and returns an `authorizationId`, reducing concurrent over-spend.
- The usage settlement endpoint updates the reserved row with final status and actual credits.
- Per-plan minute/hour/request credit limits are enforced before provider calls.
- For user-facing quota, `sift_gateway_usage_ledger` is the billing fact for Gateway calls. The local app may still record model-call health logs, but it should not double-debit the same Gateway call into `smart_quota_ledger`.

Environment:

- `SIFT_CLOUD_CONTROL_API_KEY`: protects server-to-server control-plane validation calls from the model gateway.
- `SIFT_MODEL_GATEWAY_BASE_URL` and `SIFT_MODEL_GATEWAY_API_KEY`: used by local Sift installs to call the Sift model gateway; both must be configured together.

The token validation API does not expose provider API keys and does not need raw user knowledge data.

## Not In First Version

- Full team workspace administration.
- Public marketplace or many-provider self-service setup.
- Cloud storage of the user's local knowledge base.
- Fine-grained org roles beyond owner/admin.
- Complex usage-based billing beyond plan quota and basic over-limit behavior.

## Data Boundary

Local Sift keeps:

- captures;
- source documents;
- wiki pages;
- chunks and embeddings stored in the local database;
- uploaded files;
- custom model API keys when BYOK/local mode is used.

Sift Cloud keeps:

- account identity;
- subscription and payment state;
- gateway tokens and token hashes;
- plan quota and usage ledger;
- model gateway request metadata needed for billing, debugging, and abuse control.

Sift Cloud should not store raw capture text, images, prompts, or full model responses as routine logs. Gateway request bodies may pass through for processing, but durable logs should keep metadata, not source content.

The fuller product boundary is maintained in [Client / Cloud Boundary](client-cloud-boundary.md). That document is the source of truth for P20 and later client/cloud decisions.

## Admin Operations Added For Trial

The early control plane now includes the minimum support surfaces needed before inviting real users:

- `/admin/account-support`: account lookup, subscription/quota/Gateway diagnostics, and support handling notes.
- `/admin/refunds`: manual offline refund case tracking and operational checklist.
- `/admin/retention`: signup/capture/knowledge/Ask retention view backed by `product_events` and core product tables.

These pages are protected by `SIFT_ADMIN_EMAILS`. They support early paid trials but are not a replacement for a full SaaS admin console.

## Commercial Milestone

P15 is complete when a non-technical personal user can:

1. understand Personal/Pro pricing;
2. subscribe or receive manual activation;
3. get a Sift Gateway token;
4. configure the local app without provider keys;
5. see authorization and quota status in Settings;
6. process a first capture and ask a question;
7. have the token rotated or revoked without touching provider credentials.
