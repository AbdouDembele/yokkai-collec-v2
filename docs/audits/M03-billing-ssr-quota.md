# M03 — Shared billing status quota for server-rendered pages

Fixes #386. Settings and Premium both use `getBillingSettings` after resolving the current user on the server. That shared presentation adapter now consumes the existing durable `status` quota before constructing the billing service or contacting Stripe. The existing authenticated API handler retains its quota. All three paths therefore consume the same `(user, billing scope, status)` row, without double-charging a request.

The existing database policy remains **30 reads per minute per user and scope**, shared across application instances. Checkout and portal quotas are unchanged. No in-memory or cross-user status cache is introduced, and no stale subscription result is used to grant access.

## Failure handling

Quota exhaustion or unavailable/malformed quota storage prevents any Stripe request. SSR returns the existing unavailable presentation with `status: null`, not a verified Basic membership; the rest of the page remains usable. The API keeps its `429` and `Retry-After` response. Provider failures still consume one quota slot and expose no private diagnostic. Anonymous Premium visits do not read billing, and Settings still redirects before the billing adapter.

## Provider cost and latency budget

An admitted status read currently performs one Stripe account verification and, when a customer exists, one subscription-list request. The shared limit therefore bounds these paths to **30 account verifications and at most 30 subscription-list requests per minute per user/scope**, rather than allowing unbounded SSR reloads. Denied reads perform one quota RPC and **zero Stripe operations** or billing-account claims. The existing Stripe SDK timeout/retry settings are unchanged. This quota is not a global site-wide cap.

The offline regression exercises the real Settings and Premium page functions, status Route Handler, billing orchestration, quota adapter and the existing SQL quota migration in PGlite. Only Stripe, the remote database transport, authentication and unrelated UI are replaced. It counts provider operations and reports the local test-harness elapsed time; that number is **not production Stripe latency**. No production credentials, API calls, purchases or account changes are used for verification.

- 60 alternating SSR page calls: first 30 admitted, remaining 30 unavailable; the API is then rate-limited by the same bucket.
- 75 concurrent SSR/API calls across separate module instances: exactly 30 admitted.
- Another user has an independent bucket, expiry restores access, and user IDs supplied in query strings cannot select the quota owner.
- Invalid quota results fail closed; provider errors and anonymous requests preserve their existing behavior.

Existing test assertions remain intact; the settings unit test gains a quota dependency and ordering assertions. New integration coverage is in `tests/billing-ssr-quota.test.mjs`.

No SQL migration is added or applied on the VPS. Deployment requires the existing `20261018000000_billing_request_limits.sql` migration, already required by the billing API; if it is missing, reads fail closed.
