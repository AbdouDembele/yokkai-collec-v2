# Trades inside private conversations

Offers between the signed-in player and the conversation's friend appear in the
same chronological feed as text and GIF messages. Both lots are shown from the
viewer's perspective, with cards, quantities, custom artwork, Karas and status.
The initial rendering shows the latest 20 trades; older trades can be expanded
without losing the message cursor or scroll position.

Only pending incoming offers have Accept / Decline controls. Acceptance requires
an inline confirmation of the irreversible transfer. Sending from the existing
friend-locked composer returns to the conversation and reloads its trade feed.
The standalone Trades page keeps its existing behavior.

The feature reuses `list_trade_offers` through the existing adapter and
`respond_trade_offer`: server-side friendship, blocking, ownership, locking,
auction, balance and transaction checks are unchanged. No SQL migration, grant
change, gallery upload, synthetic chat message or new data retention is added.
Both participant IDs are checked before an offer can enter the conversation or
invoke a response; the incoming flag is derived rather than trusted.

Visible conversations poll trades every five seconds without overlapping reads,
refresh on focus/online, and stop on close or loss of conversation access. Late
pre-response reads cannot restore Pending after a successful response. A
synchronous mutation lock prevents double clicks; failed actions reconcile with
the authoritative list without clearing text drafts. A remote acceptance
invalidates the existing collection and balance snapshots.

## Local preview

Run `scripts/start-private-messages-local.mjs` with `PRIVATE_MESSAGES_PORT=3003`
against the existing local Supabase configuration, then visit
`/design-system/private-messages-preview`. Add sample trades, open Message, and
switch View as to test the other participant. Trades are mocked in localStorage;
no real player, inventory or balance is changed. The preview stays forbidden in
production.

`tests/conversation-trades.test.mjs` covers scoping, orientation, chronology,
terminal statuses, race conditions, double responses, failed refreshes and
cleanup. The existing browser messaging proof now also runs
`scripts/browser-proof-conversation-trades.mjs`, covering send/accept/decline,
confirmation, returning to chat, remote status, friend isolation and mobile.
All previous browser assertions remain in place.

The user confirmed coordination with Walid regarding PR #352. The only change
inside `TradesPanel` is an optional `onOfferSent` callback. No existing product
test assertion is removed, relaxed or skipped.
