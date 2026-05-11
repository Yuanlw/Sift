# VPS + Cloudflare Zero-Start Checklist

Last checked: 2026-05-10.

This checklist is for the first controlled Sift trial, not a broad public SaaS launch.

## Minimum Purchase

### Required

1. Domain
   - Buy through Cloudflare Registrar if possible.
   - Budget: about USD 8-12/year for common TLDs, depending on TLD.
   - Cloudflare Registrar charges at-cost registry pricing with no markup.

2. VPS
   - Recommended low-cost baseline: Hetzner CX23 or equivalent.
   - Minimum spec: 2 vCPU, 4 GB RAM, 40 GB disk.
   - Budget: about EUR 3.49-4.09/month before local tax and regional differences.
   - If using DigitalOcean instead, choose at least 2 vCPU / 4 GB; budget is closer to USD 24/month.

3. Cloudflare Free plan
   - DNS, proxy, CDN, Universal SSL, basic protection.
   - Budget: USD 0/month.

4. Qwen / Alibaba Cloud Model Studio account
   - Pay-as-you-go model usage.
   - Use low-cost defaults first: qwen3.5-flash, qwen-vl-ocr, text-embedding-v4.
   - Configure model costs in Sift env before inviting users.

5. Stripe account
   - No monthly platform fee for standard Checkout usage.
   - Transaction fee depends on merchant country and payment method. US standard card pricing is 2.9% + USD 0.30 per successful domestic card transaction.

### Strongly Recommended

1. VPS automatic backups
   - Hetzner automatic backups are 20% of the instance price and keep up to seven slots.
   - For the cheapest instance this is usually under EUR 1/month.

2. Separate backup export
   - At first, daily `pg_dump` on the VPS is acceptable for trial.
   - Before wider launch, add off-server backup storage.

## Expected Monthly Baseline

Cheapest practical setup:

- VPS: about EUR 4-5/month.
- VPS automatic backup: about EUR 1/month.
- Cloudflare Free: USD 0/month.
- Domain amortized monthly: about USD 1/month.
- Stripe: no fixed monthly fee; per-transaction fee.
- Qwen models: variable; controlled by smart quota and gateway limits.

Practical first-trial cash cost: roughly USD 6-10/month plus model usage and payment fees.

If using DigitalOcean for easier US-region operation:

- VPS: about USD 24/month for 2 vCPU / 4 GB.
- Cloudflare Free: USD 0/month.
- Domain amortized monthly: about USD 1/month.
- Stripe and Qwen remain variable.

## Accounts To Create

1. Cloudflare
   - Domain registration or DNS hosting.
   - DNS proxy and SSL.

2. VPS provider
   - Hetzner recommended for minimum cost.
   - Create Ubuntu LTS server with SSH key only.

3. Alibaba Cloud Model Studio / Bailian
   - Create API key.
   - Enable selected Qwen models.
   - Set spend alerts if available.

4. Stripe
   - Create products and recurring prices.
   - Configure webhook endpoint after Sift domain is live.

## Sift Production Env

Set these on the VPS. Do not copy local `.env.local` directly.

```text
DATABASE_URL=postgres://sift:<strong-password>@postgres:5432/sift
SIFT_APP_URL=https://your-domain.example
SIFT_SESSION_SECRET=<random-32-plus-chars>
SIFT_REQUIRE_AUTH=true
SIFT_ALLOW_PUBLIC_SIGNUP=false
SIFT_TRUST_USER_HEADER=false
SIFT_ADMIN_EMAILS=you@example.com
SIFT_MODEL_KEY_ENCRYPTION_SECRET=<random-32-plus-chars>

MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=<qwen-or-gateway-openai-compatible-url>
MODEL_API_KEY=<server-side-model-key-or-local>
MODEL_TEXT_MODEL=qwen3.5-flash
MODEL_EMBEDDING_MODEL=text-embedding-v4
MODEL_EMBEDDING_DIMENSIONS=1024
MODEL_VISION_MODEL=qwen-vl-ocr

SIFT_SMART_QUOTA_USD_PER_CREDIT=0.0001
SIFT_SMART_QUOTA_COST_MULTIPLIER=2
SIFT_COST_TEXT_INPUT_USD_PER_MILLION_TOKENS=0.029
SIFT_COST_TEXT_OUTPUT_USD_PER_MILLION_TOKENS=0.287
SIFT_COST_EMBEDDING_INPUT_USD_PER_MILLION_TOKENS=0.072
SIFT_COST_VISION_INPUT_USD_PER_MILLION_TOKENS=0.043
SIFT_COST_VISION_OUTPUT_USD_PER_MILLION_TOKENS=0.072
SIFT_COST_VISION_IMAGE_USD=0.002

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PERSONAL=
STRIPE_PRICE_PRO=
STRIPE_PRICE_TEAM=
```

If the deployment also acts as the Sift Cloud control plane for Gateway validation:

```text
SIFT_CLOUD_CONTROL_API_KEY=<random-server-to-server-key>
```

If a local user app subscribes to Sift Gateway, the local app should use:

```text
SIFT_MODEL_GATEWAY_BASE_URL=https://gateway.your-domain.example/v1
SIFT_MODEL_GATEWAY_API_KEY=<scoped-sift-gateway-token>
```

Do not give users the underlying Qwen provider API key.

## Cloudflare Setup

1. Add domain to Cloudflare.
2. Point registrar nameservers to Cloudflare, if the domain is not bought there.
3. Create DNS records:

```text
A     @      <VPS IPv4>      Proxied
CNAME www    your-domain     Proxied
```

4. SSL/TLS:
   - Mode: Full strict after the VPS has a valid origin certificate or Caddy/Traefik certificate.
   - Minimum TLS: 1.2 or higher.
   - Always Use HTTPS: enabled.

5. Security:
   - Enable Bot Fight Mode or equivalent basic bot protection if available.
   - Add rate limiting later if login abuse appears.

## VPS Deployment Order

1. Create VPS.
2. Add SSH key.
3. Enable firewall:
   - allow 22 from your IP if possible;
   - allow 80 and 443 from all;
   - do not expose Postgres publicly.
4. Install Docker and Docker Compose plugin.
5. Clone Sift repo.
6. Create production `.env` from `.env.docker.example`.
7. Fill production env values.
8. Run:

```bash
docker compose up -d --build
npm run docker:migrate
npm run preflight:trial
```

9. After the domain is live, run target-environment checks:

```bash
npm run typecheck
npm run lint
npm run build
node scripts/preflight-real-user.mjs --db
```

10. Sign in as the first admin account and verify:
    - `/capture`
    - `/settings`
    - `/admin/retention`
    - `/admin/account-support`
    - `/admin/refunds`
    - first capture processing
    - model usage and smart quota display

## Launch Rule

Use this first VPS only for 10-20 controlled users.

Do not open public signup until:

- email verification exists;
- password reset exists;
- backup restore has been tested;
- model spend alerts are active;
- Stripe webhook events are verified;
- support and refund flows have been tested with real trial accounts.
