# Client / Cloud Boundary

Sift is split into two products that cooperate but should not be blurred.

## Product Split

| Layer | Owns | Does not own |
| --- | --- | --- |
| Desktop / local web / future mobile app | Capture, Inbox, Source, Wiki, Ask UI, local files, local database, BYOK/local model config | Stripe subscriptions, provider keys, shared model quota, public account operations |
| Sift Cloud control plane | Account entitlement, subscription state, Gateway token lifecycle, quota ledger, model routing authorization, admin/support tooling | The user's durable knowledge base, uploaded files, raw captures, full model responses |
| Sift Model Gateway | Validates token, reserves quota, calls underlying model providers, settles usage | Local app sessions, source/wiki storage, user-facing knowledge workflows |

The client product is where retention happens. The cloud service is where paid model access is authorized and protected.

## Data Boundary

Local or client-side Sift stores:

- captures and raw payload metadata;
- private uploads and OCR source files;
- sources, wiki pages, chunks, embeddings, merge history, audit logs;
- local BYOK or local model configuration;
- user interaction history required for the local product.

Sift Cloud stores:

- account identity and subscription entitlement;
- Gateway token hash, prefix, device/install metadata, revocation state;
- quota reservations and usage settlement records;
- admin support notes, manual refund operations, and minimal operational diagnostics.

Sift Cloud should not routinely persist raw capture text, screenshots, prompts, full model outputs, or the user's local knowledge graph. Gateway request bodies may pass through the model service, but durable logs should stay metadata-first.

## Deployment Modes

### Local Self-Managed

- User runs Sift locally or on a private VPS.
- Data stays in that database and upload directory.
- Models use local OpenAI-compatible endpoints, Ollama/LM Studio-style services, or BYOK.
- Sift Cloud is optional.

### Local App + Sift Gateway

- User runs Sift locally, but default model calls go through Sift Model Gateway.
- `SIFT_MODEL_GATEWAY_BASE_URL` and `SIFT_MODEL_GATEWAY_API_KEY` must be configured together.
- Raw content required for model processing is sent to the Gateway at request time.
- Durable knowledge data remains in the local database.

### Hosted / SaaS

- Sift app, database, uploads, control plane, and gateway are operated as a managed service.
- This is a later scaling mode, not required for early real-user validation.
- Public signup, email verification, password reset, Stripe webhooks, abuse controls, and operational monitoring become mandatory before broad launch.

## Security Rules

- Never give provider API keys to personal subscribers.
- Gateway tokens are not provider keys; they authorize Sift Gateway usage and can be revoked without rotating provider credentials.
- Local clients cannot directly write quota or entitlement.
- `POST /api/gateway/tokens/validate` and `POST /api/gateway/usage` require `SIFT_CLOUD_CONTROL_API_KEY`.
- Admin pages require a logged-in user whose email is listed in `SIFT_ADMIN_EMAILS`.
- Manual refunds record offline payout work; they do not call Stripe Refund API.

## Phase Mapping

- P18: retention observability belongs in the app and admin console.
- P19: mobile capture entry belongs in the client layer; events identify entry source.
- P20: subscription, quota, token, and model routing remain cloud/control-plane responsibilities.
- P21: real-user trial readiness checks both sides before inviting users.

