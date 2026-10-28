# Yokkai Pro promotion

Inline banner below the shared navigation on Home and Boosters only, styled in navy and ice blue.
The single call to action opens `/premium`; it never starts checkout.
Its edges match the page content: Home's 1248px container minus 28px gutters (16px on mobile), and Boosters' 1152px container minus 24px gutters.

## Visibility and preference

- Shown only after the existing `/api/pro/benefits` request confirms `active: false`.
- Hidden for Pro members, unknown status, unauthenticated requests and API failures.
- Membership is independent of profile-style availability: missing cosmetics do not turn a paid player into a promotion target.
- Hidden on every other page, and waits for the navigation's existing secondary-load stage.
- Home always displays the banner for Basic members, without a close button, regardless of the Boosters dismissal preference.
- Boosters keeps its close button: closing hides it for the rest of the browser's local calendar day using `yokkai:pro-promotion:v1:dismissed-at`. It returns at the next local midnight, including in an open tab; focus/visibility changes recheck suspended tabs. This is not a rolling 24-hour delay, and follows daylight-saving transitions. This preference only affects Boosters and synchronizes across tabs. No identity or analytics is stored.
- When browser storage is blocked, closing still hides the banner for the current mount.

## Preview and validation

The development-only `/design-system/pro-promotion-preview` route displays the presentation independently of membership, without overriding live entitlements.
It is covered by the existing production preview-route guard.

New tests cover preference expiry, strict membership gating, unavailable profile styles, storage failure, closing, accessibility and the offer link.
Tests already on master are unchanged; the new promotion tests also cover permanent Home visibility and the two-page allowlist. No SQL migration, billing change or VPS database operation.
