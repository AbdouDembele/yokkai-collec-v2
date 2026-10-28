# M01 — Referral data in the personal export

Fixes #384. Migration `20261021100000_referral_data_export.sql` is **not applied on the VPS**. It must be reviewed before a future production release. No production account, export, quota or reward was touched during this work.

## Projection and boundaries

The version-1 JSON gains two additive array sections, empty when no data exists:

- `referral_codes`: only the requesting player's `code` and `created_at`.
- `referrals`: only events where the player is the referrer or referred account; `id`, `role` (`referrer` or `referred`), `created_at`, `verified_at`, `rewarded_at`, `reward_packs`. No other player's UUID, email, invitation code or profile is included. The reward is the configured event reward, not a grant to the referred account.

The existing SQL builder is retained as an owner-only helper. Its reservation, account-deletion fence, older projections and bounds remain unchanged. The public entry point remains `service_role`-only with empty `search_path`, UTC and `STABLE` semantics. One statement combines the old export with the new rows, so the same PostgreSQL snapshot covers them. No extra application-side read or second snapshot is introduced. The existing PostgreSQL concurrency regression follows the builder chain automatically.

Both new sections count toward the existing complete-file limits: 100,000 items and 25 MiB UTF-8. Each source is bounded at 100,001 rows to detect overflow, never silently truncate. Failures still release the reservation rather than consuming the player's daily download.

## Coverage inventory

`docs/data-export-inventory.json` records every application relation in `public`, Auth account/provider records, and Storage tables. It maps explicit projections to export sections or records why the self-service export excludes a relation. The schema test compares the inventory with the fully replayed schema and verifies every mapped section exists. New tables therefore require an explicit decision rather than being silently omitted.

The inventory is a **technical coverage record, not a legal certification**. Provider/anti-fraud records, operational reservations and audit/moderation records involving third parties are explicitly marked for separate manual privacy review. This change does not silently expose those records or claim they are exempt from a person's request. The platform's session/token/MFA/OAuth internals are outside the application migration catalogue and remain excluded from automatic downloads; any access request concerning them requires the same manual review. Unknown future profile columns remain excluded by existing explicit projection tests.

## Oversized export support procedure

The English `413` response and Settings panel direct the player to `yokkaicollec@gmail.com`, subject **Data export request**, from their account email address. They explicitly warn against sending passwords or sign-in codes. The automatic size and time limits are unchanged; no partial file is delivered.

Operator workflow:

1. Record the request without asking for passwords, tokens, sign-in codes or unnecessary identity documents. An email address alone is not proof of ownership.
2. Verify ownership through an approved authenticated support process; do not accept an arbitrary account ID or destination supplied by email. If ownership is uncertain, escalate rather than export.
3. Review the inventory, including manual-review records and third-party minimization. For very large accounts, use an operator-reviewed bounded/chunked export outside the automatic route. Do not raise its hard limits or create a public storage link as a workaround.
4. Arrange an authenticated, access-controlled delivery and retention/deletion plan before generating files. Do not email the raw export or log its contents. Delete temporary material once delivery and the approved retention period permit it.

This documents the escalation process; it does not add an automated support mailbox processor, a new download endpoint or a public link.

## Regression coverage

New tests reproduce the missing sections before this migration, check both referral roles and reward dates, prove no counterpart identities/codes leak, preserve all prior sections and reservation state, deny helper/player access, count new records toward the old cap, and ensure a failed generation can retry. The existing test allowlist only gains the new helper as **owner-only**; it grants no role additional access. API tests cover both SQL and final UTF-8 overflow paths, private response headers and reservation release. Existing assertions are not removed or relaxed.
