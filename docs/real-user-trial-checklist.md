# Real User Trial Checklist

This checklist is for the first 10-20 target users. The goal is not growth. The goal is to prove that real users keep capturing and return to use the knowledge.

## Trial Gate

Do not invite users until these are true:

- `/capture` works on mobile and redirects back to today's Inbox after save.
- `product_events` is migrated, so signup, capture, source/wiki creation, Ask, and capture entry events are visible.
- `/admin/retention` is accessible to a whitelisted admin.
- `/admin/account-support` can look up a user by email and add support handling notes.
- `/admin/refunds` can record an offline refund and checklist status.
- Settings shows subscription, quota, and Gateway authorization status.
- Gateway token validation rejects revoked, expired, unpaid, over-quota, and rate-limited requests.
- Run `npm run preflight:trial` before each invited-user build or deploy.

## Metrics To Watch

Use `/admin/retention` for the first pass:

- 10-minute activation: new user completes first capture within 10 minutes.
- D1+ capture: eligible users capture again after day 1.
- D7+ capture: eligible users capture again after day 7.
- Weekly capture days: users are forming a habit, not just batch-importing.
- Source/Wiki conversion: saved material becomes reusable knowledge.
- Ask users: users come back to retrieve or reason over the saved knowledge.

## Support Workflow

For every trial issue:

- Search the account in `/admin/account-support`.
- Record issue type, contact status, and a short handling note.
- If the issue involves model access, inspect Gateway token status and recent rejected/failure usage.
- If the user asks for a refund, create or update the case in `/admin/refunds`.
- For offline refunds, mark checklist items before changing the refund status to paid.

## Stop / Continue Rules

Continue product iteration if:

- users capture from mobile without being reminded;
- at least some users return after day 1 and day 7;
- saved content produces Source/Wiki pages without manual cleanup;
- users ask questions against their own saved data.

Pause growth and fix the product if:

- 10-minute activation is weak;
- users only batch-import once and never return;
- mobile capture source events are mostly missing or coming from desktop only;
- support cases show repeated login, token, quota, or processing confusion.

## Preflight

Use:

```bash
npm run preflight:trial
```

For a deployment with reachable Postgres, also run:

```bash
node scripts/preflight-real-user.mjs --db
```

The script does not print secrets. It checks key files, schema markers, required env shape, Gateway env pairing, admin readiness, and optional paid-launch variables.

Before deployment, also follow [Deployment Readiness Checklist](deployment-readiness.md). P22 treats trial preflight as necessary but not sufficient: database migration, built-server smoke, and runtime route checks still need to pass in the target environment.
