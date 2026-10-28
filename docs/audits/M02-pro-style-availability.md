# M02 — Separate Pro membership from cosmetic availability

Issue #385. Membership presentation is derived exclusively from the strict
boolean returned by the authenticated, uncached `/api/pro/benefits` request.
The provider publishes this result before requesting the optional profile style.
An HTTP error, malformed JSON, network error or timeout in the style request
cannot turn a confirmed Pro member into Basic or unknown membership.

The profile style editor displays **PRO ACTIVE** and **Profile style unavailable**
when membership is confirmed but cosmetics cannot load. Its disabled save button
and accessible help explain the outage instead of requesting another purchase.
Other Pro feature notices likewise distinguish a confirmed Basic account from
temporarily unavailable Pro presentation. Failed or invalid benefits responses
remain unknown, never inferred as Basic or Pro.

## Preserved boundaries

- `useProAccess` still requires both confirmed Pro benefits and a valid active
  style projection. A failed refresh removes old cosmetics and disables saves.
- No local flags, browser events, cached styles or truthy strings grant access.
- Server membership checks, billing, mutations, endpoints and SQL are unchanged.
- The existing 10-second abort bound, visibility checks, cleanup, focus/online
  refresh and 30-second interval remain. Unmount ignores late responses.
- No player data, subscription or payment is created or modified for validation.

## Regression coverage

The new test executes the actual provider, style fields, notices and isolated
profile style editor. It reproduces the failure before the fix, then checks
HTTP/network/JSON/timeout failures, inactive and forged style projections,
slow-style publication ordering, recovery, stale-style clearing, Basic transition,
unavailable or forged benefits and unmount cleanup. Disabled saves cannot invoke
a mutation. Existing test assertions are unchanged; the existing isolated fields
mock only gains the membership hook matching its existing Basic/Pro scenario.

## Deployment

No Supabase migration. No SQL, schema, grants or storage changes to apply on the
VPS. Application deployment follows a green GitHub Actions PR on current master.
