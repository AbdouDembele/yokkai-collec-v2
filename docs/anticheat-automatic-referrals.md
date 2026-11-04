# Automatic affiliate-abuse safeguards

## Decision thresholds

- A shared public network address is context only. It never bans an account.
- At least four email-verified referral accounts must share a network identity with their referrer within seven days before the cohort is reviewed.
- When the device cookie also matches between the referrer and at least four such referrals, the system suspends those referred accounts, revokes their active sessions, removes only unused referral pack bonuses, and shows the referrer an account warning.
- Rewards for verified referrals in a network-only review are held. A new observation extends the quiet period. If no further signal arrives for seven days, the referral reward is released. If device confirmation arrives, the pending reward is canceled with the referral account suspension.
- A matching device cookie means the same first-party browser profile was observed. It is corroborating evidence, not proof of a person’s identity; shared household devices remain a possible explanation. Automatic action is therefore limited to the four-account cohort threshold and the admin case/Discord logs should be reviewed for appeals.
- The existing self-deletion email cooldown blocks reuse of the same email for 14 days. It is stored as a keyed HMAC, expires automatically, and does not apply to administrator bans.

## Booster and card provenance

- Each referral reward granted after the provenance migration is stored as a separate pack lot for the referrer and the referred player. Opening a regular pack records whether it came from a referral reward, a timed pack, or a legacy bonus balance.
- Each generated card instance is tied to its pack opening and original owner. Accepted trades, completed auction sales, other ownership transfers, and removals are appended to that instance's transfer history.
- The anti-cheat admin event details can show the referral pair, the recipient role, the pack opening time, and the recorded transfer/sale trail for cards in successful trades. A bounded admin-only reader returns this information; it is not exposed to players.
- Existing bonus packs at rollout and cards opened before rollout are marked as legacy/unattributed. Their source must not be guessed. Transfers before the migration are not reconstructed as a complete per-instance chain.
- This ledger provides evidence for human review. Provenance alone does not automatically prove abuse or trigger a sanction.

## Discord alert configuration

The webhook URL is a credential. If it has been pasted into chat, a ticket, a commit, or a log, revoke it in Discord and create a replacement before configuring alerts. Never put it in source code, a migration, browser configuration, or a `NEXT_PUBLIC_*` variable.

The migration creates a private `anticheat_discord_config` table and a database outbox. After the migration is deployed, a database operator can provision the rotated URL through a protected `psql` session using an environment variable from the approved secret manager:

```psql
\getenv webhook_url YOKKAI_ANTICHEAT_DISCORD_WEBHOOK
insert into public.anticheat_discord_config(id, webhook_url)
values (true, :'webhook_url')
on conflict (id) do update set webhook_url = excluded.webhook_url;
\unset webhook_url
```

Do not enable shell tracing or save the secret in command history. The scheduled database dispatcher sends queued alerts; the payload contains event type, public pseudonyms, reason codes, counts and event timestamp, but no email address, raw IP address or device digest. Delivery is asynchronous through `pg_net`; confirm delivery in the private Discord channel and monitor failed dispatch warnings/outbox backlog after setup.

## Rollout

The following migrations have not been applied to the VPS:

- `20261103240000_referral_network_enforcement.sql`
- `20261103250000_referral_pack_provenance.sql`

Apply them only after the PR is current with `origin/master`, GitHub Actions is green, the team is notified in Discord, and no other production SQL change is in progress. Configure the rotated webhook after deployment and verify one controlled alert before relying on the channel.
